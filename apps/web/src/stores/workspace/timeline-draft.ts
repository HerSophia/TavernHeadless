import type { TimelineMessage } from "./types";

export async function animateMockAssistantReply(message: TimelineMessage, sourceMessage: string, startAt: number): Promise<void> {
  const draft = createAssistantDraft(sourceMessage);
  let cursor = 0;

  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      cursor += 3;
      message.content = draft.slice(0, cursor);

      if (cursor >= draft.length) {
        window.clearInterval(timer);
        resolve();
      }
    }, 26);
  });

  message.streaming = false;
  message.latencyMs = Date.now() - startAt;
  message.tokens = Math.max(120, Math.floor(draft.length / 2));
}

function inferDraftLanguage(sourceMessage: string): "zh" | "en" {
  if (/[\u3400-\u9fff]/.test(sourceMessage)) {
    return "zh";
  }

  return "en";
}

function createAssistantDraft(sourceMessage: string): string {
  if (inferDraftLanguage(sourceMessage) === "zh") {
    return "她把手按在玻璃柜边缘，呼吸压得很低。\n\n\"温度曲线不对。它刚刚吸收了一次环境噪声，然后反向放大。\"\n\n她抬眼看向你：\"我们得先锁门，再读铭文。\"";
  }

  return "She braces one hand against the display case and lowers her voice.\n\n\"The temperature curve is wrong. It absorbed ambient noise, then amplified it back.\"\n\nShe looks at you. \"Lock the doors first, then we read the inscription.\"";
}
