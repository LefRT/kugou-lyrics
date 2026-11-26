/** 从舞台返回：站内进来的回上一页（保留原路由），直接打开才回首页。 */
export const goBackFromStage = () => {
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin) {
      window.history.back();
      return;
    }
  } catch { /* referrer 解析失败按直接访问处理 */ }
  window.location.href = '/';
};
