/**
 * Floor Lineage Service
 *
 * 专职的 floor ancestry 解析层。只负责从 `floor` 表读取 lineage 必须的最小字段，
 * 并对外提供 ancestry 级别的查询能力。具体业务读取接口（branch diff、history loader、
 * timeline 等）通过这一层获得统一语义，不再各自按 `floorNo` 推断共享历史或 fork 点。
 *
 * 约束：
 * - `floorNo` 只作展示与排序，不作 ancestry 身份键。
 * - ancestry 身份以真实 `floorId` 为准，通过 `parentFloorId` 链回溯。
 * - 默认仅考虑 `supersededAt IS NULL` 的 live 楼层；被 supersede 的楼层视为历史
 *   阴影，不参与 ancestry 解析。
 */

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors } from "../db/schema.js";

/**
 * lineage 解析所需的楼层元数据投影。
 *
 * 故意保持最小字段集，避免 lineage 服务层被其它业务语义污染。
 */
export interface FloorLineageNode {
  id: string;
  sessionId: string;
  branchId: string;
  floorNo: number;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
  supersededAt: number | null;
}

export interface FloorAncestryChain {
  /**
   * 从 tip（最深处）回溯到根的 floor 序列。
   *
   * 数组第一个元素是 tip 本身，最后一个元素是最顶层的祖先。
   * 回溯过程中只跟随 `parentFloorId`，不依赖 `floorNo`。
   */
  nodes: FloorLineageNode[];
}

export interface FloorBranchDiff {
  /** base branch 的 tip floor。若 branch 不存在则为 null。 */
  baseTip: FloorLineageNode | null;
  /** target branch 的 tip floor。若 branch 不存在则为 null。 */
  targetTip: FloorLineageNode | null;
  /**
   * 最近共同祖先 floor。
   *
   * 仅当两个 branch 的 ancestry 链在某个 `floorId` 上真实相交时才有值。
   * 两 branch 的 `floorNo` 相同但 ancestry 不同时，该字段保持为 null。
   */
  forkFloor: FloorLineageNode | null;
  /** shared ancestry 段。从靠近 fork 的位置向上遍历。 */
  sharedFloors: FloorLineageNode[];
  /** base branch 独占的 ancestry 段（不含 fork）。 */
  baseOnlyFloors: FloorLineageNode[];
  /** target branch 独占的 ancestry 段（不含 fork）。 */
  targetOnlyFloors: FloorLineageNode[];
}

function toNode(row: {
  id: string;
  sessionId: string;
  branchId: string;
  floorNo: number;
  parentFloorId: string | null;
  state: "draft" | "generating" | "committed" | "failed";
  supersededAt: number | null;
}): FloorLineageNode {
  return {
    id: row.id,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorNo: row.floorNo,
    parentFloorId: row.parentFloorId,
    state: row.state,
    supersededAt: row.supersededAt,
  };
}

export interface FloorLineageResolveOptions {
  /**
   * 是否把 `supersededAt != null` 的楼层纳入 lineage。
   * 默认 false；`branches/diff` 与 history loader 都应使用默认值。
   */
  includeSuperseded?: boolean;
  /**
   * 仅保留指定状态的楼层。默认 `["committed"]`，与现有 history / diff 行为一致。
   * 传 undefined 时不过滤状态。
   */
  states?: Array<FloorLineageNode["state"]>;
}

const DEFAULT_STATES: FloorLineageNode["state"][] = ["committed"];

export class FloorLineageService {
  constructor(private readonly db: AppDb) {}

  /**
   * 加载 session 内被 supersede 的 floor 的 `id -> parentFloorId` 映射。
   *
   * 提供给 `resolveAncestryChain()` 使用，以便 regenerate 等会让新楼层指向
   * 被 supersede 旧楼层的场景下，ancestry 链仍能正确穿透。
   *
   * 注意这里拿的是被 supersede 楼层自身的 `parentFloorId`，而不是它的
   * `supersededByFloorId`。穿透目的是"跳过被替代的位置，去到更上层的祖先"。
   */
  async loadSupersedeIndex(
    sessionId: string,
    executor?: DbExecutor,
  ): Promise<Map<string, string | null>> {
    const db = executor ?? this.db;
    const rows = await db
      .select({ id: floors.id, parentFloorId: floors.parentFloorId })
      .from(floors)
      .where(and(eq(floors.sessionId, sessionId), isNotNull(floors.supersededAt)));

    const index = new Map<string, string | null>();
    for (const row of rows) {
      index.set(row.id, row.parentFloorId);
    }
    return index;
  }

  /**
   * 加载指定会话里参与 lineage 解析的全部楼层元数据。
   *
   * 这是最底层的 IO 入口，所有 ancestry 查询都从这里出发。单次调用即可覆盖
   * 整个会话常见的 branch 对比 / history 解析需求，避免在上层做 N+1 查询。
   */
  async loadSessionNodes(
    sessionId: string,
    options: FloorLineageResolveOptions = {},
    executor?: DbExecutor,
  ): Promise<FloorLineageNode[]> {
    const db = executor ?? this.db;
    const states = options.states ?? DEFAULT_STATES;
    const conditions = [eq(floors.sessionId, sessionId)];

    if (!options.includeSuperseded) {
      conditions.push(isNull(floors.supersededAt));
    }

    if (states.length > 0) {
      conditions.push(inArray(floors.state, states));
    }

    const rows = await db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
        floorNo: floors.floorNo,
        parentFloorId: floors.parentFloorId,
        state: floors.state,
        supersededAt: floors.supersededAt,
      })
      .from(floors)
      .where(and(...conditions));

    return rows.map(toNode);
  }

  /**
   * 取某个 branch 当前的 tip floor。
   *
   * tip 定义为该 branch 内 `floorNo` 最大的 live 楼层。`floorNo` 仅用于选择
   * tip 位置，lineage 链身份仍由 `parentFloorId` 决定。
   */
  findBranchTip(
    nodes: FloorLineageNode[],
    branchId: string,
  ): FloorLineageNode | null {
    let tip: FloorLineageNode | null = null;
    for (const node of nodes) {
      if (node.branchId !== branchId) continue;
      if (!tip || node.floorNo > tip.floorNo) {
        tip = node;
      }
    }
    return tip;
  }

  /**
   * 从指定 tip 出发，沿 `parentFloorId` 回溯得到 ancestry 链。
   *
   * 遇到无法解析的 `parentFloorId`（例如父楼层不在 nodes 集合里）时安静停止，
   * 不抛错。上层如需严格校验可自行对比 `chain.nodes` 的长度与预期深度。
   *
   * 如果调用方提供了 `supersedeIndex`（`supersededFloorId -> supersededByFloorId`
   * 的映射），则在回溯过程中会穿透"被 supersede 的父楼层"，继续沿它的
   * parent 回溯。这是为了支撑 regenerate 的 ancestry 语义：
   *
   *   旧楼层 f(n)  <── superseded_by ── 新楼层 f(n)_new
   *   旧楼层 f(n).parent = f(n-1)
   *   新楼层 f(n)_new.parent = f(n)  (指向被它替代的旧楼层)
   *
   * 只靠 live 节点回溯时新楼层的 ancestry 会断在 f(n)，拿不到 f(n-1)。
   * 提供 `supersedeIndex` 后，回溯时遇到 f(n) 会被替换为 f(n-1) 继续前进，
   * 最终得到与调用方预期一致的 ancestry 链。
   */
  resolveAncestryChain(
    nodes: FloorLineageNode[],
    tipFloorId: string,
    supersedeIndex?: Map<string, string | null>,
  ): FloorAncestryChain {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const chain: FloorLineageNode[] = [];
    const visited = new Set<string>();

    let currentId: string | null = tipFloorId;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        // parent 指回已访问节点视为脏数据；停止回溯避免死循环。
        break;
      }
      visited.add(currentId);

      const node = nodeById.get(currentId);
      if (node) {
        chain.push(node);
        currentId = node.parentFloorId;
        continue;
      }

      // 当前 id 不在 live 节点集合里：如果 supersedeIndex 能穿透，
      // 就跳到被 supersede 楼层的 parent 继续回溯；否则停止。
      if (supersedeIndex && supersedeIndex.has(currentId)) {
        currentId = supersedeIndex.get(currentId) ?? null;
        continue;
      }

      break;
    }

    return { nodes: chain };
  }

  /**
   * 针对一个 branch，给出该 branch 当前 tip 的可见 ancestry（按 floor id）。
   *
   * 输出顺序为从祖先到 tip（即把 `resolveAncestryChain` 结果反转后的序列），
   * 方便 history loader 顺序加载消息。
   */
  resolveVisibleAncestryFloorIds(
    nodes: FloorLineageNode[],
    branchId: string,
    beforeFloorNo?: number,
    supersedeIndex?: Map<string, string | null>,
  ): string[] {
    const tip = this.findBranchTip(nodes, branchId);
    if (!tip) {
      return [];
    }

    const chain = this.resolveAncestryChain(nodes, tip.id, supersedeIndex).nodes;
    const filtered = beforeFloorNo === undefined
      ? chain
      : chain.filter((node) => node.floorNo < beforeFloorNo);

    // chain 是 tip -> root 顺序，history 期望 root -> tip。
    return [...filtered].reverse().map((node) => node.id);
  }

  /**
   * 按两个 branch 的 tip 计算 ancestry diff。
   *
   * 计算规则：
   * 1. 分别回溯 base 与 target 的 ancestry 链。
   * 2. 以 base ancestry 的 floorId 集合为基准，遍历 target ancestry 时第一个
   *    命中的节点即为最近共同祖先 forkFloor。
   * 3. shared 段为 fork 及其祖先；base/target only 段为 fork 之上的各自独占部分。
   * 4. 若两条 chain 无相交，则 forkFloor = null，sharedFloors = []，
   *    baseOnlyFloors / targetOnlyFloors 分别为各自完整 chain。
   *
   * 这里不会因为两个 branch 恰好在某个 `floorNo` 撞号而误判 shared。
   */
  computeBranchDiff(
    nodes: FloorLineageNode[],
    baseBranchId: string,
    targetBranchId: string,
    supersedeIndex?: Map<string, string | null>,
  ): FloorBranchDiff {
    const baseTip = this.findBranchTip(nodes, baseBranchId);
    const targetTip = this.findBranchTip(nodes, targetBranchId);

    if (!baseTip || !targetTip) {
      return {
        baseTip,
        targetTip,
        forkFloor: null,
        sharedFloors: [],
        baseOnlyFloors: baseTip ? this.resolveAncestryChain(nodes, baseTip.id, supersedeIndex).nodes : [],
        targetOnlyFloors: targetTip ? this.resolveAncestryChain(nodes, targetTip.id, supersedeIndex).nodes : [],
      };
    }

    const baseChain = this.resolveAncestryChain(nodes, baseTip.id, supersedeIndex).nodes;
    const targetChain = this.resolveAncestryChain(nodes, targetTip.id, supersedeIndex).nodes;
    const baseIds = new Set(baseChain.map((node) => node.id));

    let forkFloor: FloorLineageNode | null = null;
    let forkIndexInTarget = -1;
    for (let i = 0; i < targetChain.length; i += 1) {
      const node = targetChain[i]!;
      if (baseIds.has(node.id)) {
        forkFloor = node;
        forkIndexInTarget = i;
        break;
      }
    }

    if (!forkFloor || forkIndexInTarget < 0) {
      return {
        baseTip,
        targetTip,
        forkFloor: null,
        sharedFloors: [],
        baseOnlyFloors: baseChain,
        targetOnlyFloors: targetChain,
      };
    }

    const forkIndexInBase = baseChain.findIndex((node) => node.id === forkFloor!.id);
    const sharedFloors = forkIndexInBase >= 0 ? baseChain.slice(forkIndexInBase) : [forkFloor];
    const baseOnlyFloors = forkIndexInBase >= 0 ? baseChain.slice(0, forkIndexInBase) : baseChain;
    const targetOnlyFloors = targetChain.slice(0, forkIndexInTarget);

    return {
      baseTip,
      targetTip,
      forkFloor,
      sharedFloors,
      baseOnlyFloors,
      targetOnlyFloors,
    };
  }
}
