import { createI18n } from "vue-i18n";

import { app } from "./messages/app";
import { nav } from "./messages/nav";
import { topbar } from "./messages/topbar";
import { connection } from "./messages/connection";
import { workbench } from "./messages/workbench";
import { library } from "./messages/library";
import { settings } from "./messages/settings";
import { graph } from "./messages/graph";
import { graphNode } from "./messages/graph-node";
import { chat } from "./messages/chat";
import { graphAssistant } from "./messages/graph-assistant";

/** 受支持的界面语言。新增语言时在此登记，并为每个 messages 模块补齐该语言。 */
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * 组装各命名空间为 vue-i18n 的 messages。
 *
 * 这里显式列出每个命名空间，而非动态拼装，以保留 t() 的 key 类型推导与补全。
 * 新增命名空间：在 messages/ 下加一个模块文件，然后在此为每个语言登记一行。
 */
const messages = {
  "zh-CN": {
    app: app["zh-CN"],
    nav: nav["zh-CN"],
    topbar: topbar["zh-CN"],
    connection: connection["zh-CN"],
    workbench: workbench["zh-CN"],
    library: library["zh-CN"],
    settings: settings["zh-CN"],
    graph: graph["zh-CN"],
    graphNode: graphNode["zh-CN"],
    chat: chat["zh-CN"],
    graphAssistant: graphAssistant["zh-CN"],
  },
  "en": {
    app: app["en"],
    nav: nav["en"],
    topbar: topbar["en"],
    connection: connection["en"],
    workbench: workbench["en"],
    library: library["en"],
    settings: settings["en"],
    graph: graph["en"],
    graphNode: graphNode["en"],
    chat: chat["en"],
    graphAssistant: graphAssistant["en"],
  },
} as const;

/** 以默认语言（第一个）为文案结构基准，供需要类型对齐处引用。 */
export type MessageSchema = (typeof messages)["zh-CN"];

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: "zh-CN",
  fallbackLocale: "en",
  messages,
});
