export function registerPrompts(server) {
  server.registerPrompt(
    "addition-system-instruction",
    {
      title: "附加系统指令",
      description: "在加载 NetTopology 智能体时注入到任务系统提示词的指令",
    },
    async () => {
      return {
        messages: [{
          role: "assistant",
          content: {
            type: "text",
            text: "<!-- NetTopology: 你可以使用网络拓扑发现工具。从 discover_subnets 开始识别内网网段，然后用 full_scan 一键完成拓扑扫描。扫描结果会在右侧 UI 面板渲染为交互式拓扑图。 -->",
          },
        }],
      };
    },
  );
}
