/**
 * 连线交互增强的几何纯函数（NG2-6，可单测、无 DOM 依赖）。
 *
 * 承载 lazy connect（拖到目标节点附近自动选最近兼容输入端口）与 cut connection
 * （划线相交断开连线）的几何计算。端口类型兼容判断复用 core 导出的 `arePortTypesCompatible`，
 * 保证前后端同源。
 */
import { arePortTypesCompatible, type NodeGraphPortType } from "@tavern/core/node-graph";

export interface Point {
  x: number;
  y: number;
}

export interface LineSegment {
  a: Point;
  b: Point;
}

/** lazy connect 的候选输入端口（画布坐标 + 类型 + 占用态）。 */
export interface CandidateInputPort {
  nodeId: string;
  port: string;
  type: NodeGraphPortType;
  /** 端口在画布上的位置。 */
  position: Point;
  /** 该输入端口是否已被占用（单值端口已有入边）。 */
  occupied: boolean;
}

/** 两点欧氏距离。 */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * lazy connect：在候选输入端口中挑出与 `sourceType` 类型兼容、未占用、且距离落点最近的一个。
 *
 * @param sourceType 拖出连线的源输出端口类型
 * @param dropPoint 松手落点（画布坐标）
 * @param candidates 目标节点上的候选输入端口
 * @param maxDistance 最大吸附距离；超过则不连接
 * @returns 最近的兼容端口，无则返回 null
 */
export function pickLazyConnectTarget(
  sourceType: NodeGraphPortType,
  dropPoint: Point,
  candidates: CandidateInputPort[],
  maxDistance = Number.POSITIVE_INFINITY,
): CandidateInputPort | null {
  let best: CandidateInputPort | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.occupied || !arePortTypesCompatible(sourceType, candidate.type)) {
      continue;
    }
    const dist = distance(dropPoint, candidate.position);
    if (dist <= maxDistance && dist < bestDistance) {
      best = candidate;
      bestDistance = dist;
    }
  }
  return best;
}

/**
 * 判断两条线段是否相交（含端点接触）。用于 cut connection 划线与连线相交检测。
 *
 * 采用标准的方向叉积 + 共线端点判定。
 */
export function segmentsIntersect(p1: LineSegment, p2: LineSegment): boolean {
  const d1 = cross(p2.a, p2.b, p1.a);
  const d2 = cross(p2.a, p2.b, p1.b);
  const d3 = cross(p1.a, p1.b, p2.a);
  const d4 = cross(p1.a, p1.b, p2.b);

 if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(p2.a, p2.b, p1.a)) {
    return true;
  }
  if (d2 === 0 && onSegment(p2.a, p2.b, p1.b)) {
    return true;
  }
  if (d3 === 0 && onSegment(p1.a, p1.b, p2.a)) {
    return true;
  }
  if (d4 === 0 && onSegment(p1.a, p1.b, p2.b)) {
    return true;
  }
  return false;
}

/** 叉积：向量 (a→b) × (a→p) 的 z 分量符号（>0 左侧、<0 右侧、=0 共线）。 */
function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** 已知 p 与 a→b 共线时，判断 p 是否落在线段 [a,b] 的包围盒内。 */
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

/** cut connection 的候选连线（边 id + 画布坐标的两端点）。 */
export interface CuttableEdge {
  id: string;
  segment: LineSegment;
}

/**
 * 返回与划线（cut line）相交的所有连线 id。
 *
 * @param cutLine 用户按住 Ctrl 拖出的划线
 * @param edges 当前可见连线（两端点为画布坐标）
 * @returns 相交的边 id 列表
 */
export function collectCutEdges(cutLine: LineSegment, edges: CuttableEdge[]): string[] {
  const result: string[] = [];
  for (const edge of edges) {
    if (segmentsIntersect(cutLine, edge.segment)) {
      result.push(edge.id);
    }
  }
  return result;
}
