import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  base: '/TavernHeadless/',
  title: 'TavernHeadless',
  description: '一个为开发者而生的 AI RP 后端引擎',

  head: [
    ['meta', { name: 'theme-color', content: '#2dd4bf' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:site_name', content: 'TavernHeadless' }],
  ],

  themeConfig: {
    logo: undefined,
    siteTitle: 'TavernHeadless',

    nav: [
      {
        text: '指南',
        items: [
          { text: '简介', link: '/guide/introduction' },
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '架构设计', link: '/guide/architecture' },
          { text: '官方集成层', link: '/guide/integration-kit' },
          { text: '前端设计', link: '/guide/frontend-vision' },
        ],
      },
      {
        text: '开发',
        items: [
          { text: '协作指南', link: '/development/contributing' },
          { text: '测试与 CI', link: '/development/testing' },
          { text: '文档规范', link: '/development/doc-standards' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: '数据库字典', link: '/reference/database' },
          { text: 'API 参考', link: '/reference/api' },
          { text: 'API 资源索引', link: '/reference/api/sessions' },
        ],
      },
      {
        text: 'SDK',
        items: [
          { text: '总览', link: '/sdk/' },
          { text: 'Sessions', link: '/sdk/sessions' },
          { text: 'Chat', link: '/sdk/chat' },
          { text: 'Client Helpers', link: '/sdk/client-helpers' },
        ],
      },
      { text: 'Agent', link: '/agent/' },
      { text: '进度', link: '/progress/' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '简介', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '架构设计', link: '/guide/architecture' },
            { text: '官方集成层', link: '/guide/integration-kit' },
            { text: '前端设计', link: '/guide/frontend-vision' },
          ],
        },
      ],
      '/development/': [
        {
          text: '开发',
          items: [
            { text: '协作指南', link: '/development/contributing' },
            { text: '测试与 CI', link: '/development/testing' },
            { text: '文档规范', link: '/development/doc-standards' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '数据库字典', link: '/reference/database' },
            { text: 'API 参考', link: '/reference/api' },
          ],
        },
        {
          text: 'API 资源',
          items: [
            { text: 'Sessions（会话）', link: '/reference/api/sessions' },
            { text: 'Chat（对话生成）', link: '/reference/api/chat' },
            { text: 'Floors（楼层）', link: '/reference/api/floors' },
            { text: 'Pages（消息页）', link: '/reference/api/pages' },
            { text: 'Messages（消息）', link: '/reference/api/messages' },
            { text: 'Characters（角色卡）', link: '/reference/api/characters' },
            { text: 'Users（用户卡）', link: '/reference/api/users' },
            { text: 'Variables（变量）', link: '/reference/api/variables' },
            { text: 'Macros（宏系统）', link: '/reference/api/macros' },

            { text: 'Memories（记忆）', link: '/reference/api/memories' },
            { text: 'Imports（导入）', link: '/reference/api/imports' },
            { text: 'Exports（导出）', link: '/reference/api/exports' },
            { text: 'Presets（预设）', link: '/reference/api/presets' },
            { text: 'Worldbooks（世界书）', link: '/reference/api/worldbooks' },
            { text: 'Regex Profiles（正则配置）', link: '/reference/api/regex-profiles' },
            { text: 'LLM Profiles', link: '/reference/api/llm-profiles' },
            { text: 'LLM Instances（实例配置）', link: '/reference/api/llm-instances' },
            { text: 'Tools（工具调用）', link: '/reference/api/tools' },
            { text: 'MCP Servers（MCP 服务器）', link: '/reference/api/mcp' },
            { text: 'Accounts（账号）', link: '/reference/api/accounts' },
          ],
        },
        {
          text: '高级 API 资源',
          items: [
            { text: 'Prompt Runtime（提示词运行时）', link: '/reference/api/prompt-runtime' },
            { text: 'Chat Transfer Jobs（聊天传输作业）', link: '/reference/api/chat-transfer-jobs' },
            { text: 'Memory Jobs（记忆后台作业）', link: '/reference/api/memory-jobs' },
            { text: 'Client Data（客户端专属数据域）', link: '/reference/api/client-data' },
          ],
        },
      ],
      '/sdk/': [
        {
          text: 'SDK 总览',
          items: [
            { text: '安装与配置', link: '/sdk/' },
            { text: '错误处理', link: '/sdk/errors' },
            { text: 'SSE 流', link: '/sdk/sse' },
          ],
        },
        {
          text: '资源方法',
          items: [
            { text: 'Sessions（会话）', link: '/sdk/sessions' },
            { text: 'Chat（对话生成）', link: '/sdk/chat' },
            { text: 'Floors（楼层）', link: '/sdk/floors' },
            { text: 'Pages（消息页）', link: '/sdk/pages' },
            { text: 'Messages（消息）', link: '/sdk/messages' },
            { text: 'Characters（角色卡）', link: '/sdk/characters' },
            { text: 'Users（用户卡）', link: '/sdk/users' },
            { text: 'Accounts（账号）', link: '/sdk/accounts' },
            { text: 'Variables（变量）', link: '/sdk/variables' },
            { text: 'Memories（记忆）', link: '/sdk/memories' },
            { text: 'Imports（导入）', link: '/sdk/imports' },
            { text: 'Exports（导出）', link: '/sdk/exports' },
            { text: 'Presets（预设）', link: '/sdk/presets' },
            { text: 'Worldbooks（世界书）', link: '/sdk/worldbooks' },
            { text: 'Regex Profiles（正则配置）', link: '/sdk/regex-profiles' },
            { text: 'LLM Profiles', link: '/sdk/llm-profiles' },
            { text: 'LLM Instances（实例配置）', link: '/sdk/llm-instances' },
            { text: 'Tools（工具调用）', link: '/sdk/tools' },
            { text: 'MCP Servers', link: '/sdk/mcp' },
          ],
        },
        {
          text: 'Client Helpers',
          items: [
            { text: 'Client Helpers', link: '/sdk/client-helpers' },
          ],
        },
      ],
      '/agent/': [
        {
          text: 'Agent',
          items: [
            { text: 'Agent 接入', link: '/agent/' },
          ],
        },
      ],
      '/progress/': [
        {
          text: '进度',
          items: [
            { text: '总览', link: '/progress/' },
            { text: '核心引擎', link: '/progress/core' },
            { text: '后端 API', link: '/progress/api' },
            { text: '管理前端', link: '/progress/web' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/HerSophia/TavernHeadless' }],

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    lastUpdated: {
      text: '最后更新',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '未找到结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
  },
});
