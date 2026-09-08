document.addEventListener("DOMContentLoaded", () => {
  const content =
    document.querySelector(".single-post") ||
    document.querySelector(".post-content") ||
    document.querySelector("article") ||
    document.querySelector("main");

  if (!content) {
    console.warn("Obsidian Wiki Link：找不到文章正文");
    return;
  }

  // =========================
  // 读取 Hugo 页面列表
  // =========================

  const pageData =
    document.getElementById("hugo-pages");

  let pages = [];

  if (pageData) {
    try {
      pages = JSON.parse(pageData.textContent);
    } catch (error) {
      console.error(
        "Obsidian Wiki Link：Hugo 页面列表解析失败",
        error
      );
    }
  }

  // =========================
  // 标准化名称
  // =========================

  function normalize(value) {
    return String(value || "")
      .trim()
      .replace(/\.md$/i, "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
  }

  // =========================
  // 寻找文章
  // =========================

  function findPage(name) {
    const target = normalize(name);

    // 1. 文件名 / 标题 / slug
    const page = pages.find(page => {
      return [
        page.fileName,
        page.name,
        page.title,
        page.slug
      ].some(value => {
        return normalize(value) === target;
      });
    });

    if (page) {
      return page;
    }

    // 2. URL 最后一段
    const byUrl = pages.find(page => {
      if (!page.url) {
        return false;
      }

      const lastPart = page.url
        .replace(/\/+$/, "")
        .split("/")
        .pop();

      return normalize(lastPart) === target;
    });

    if (byUrl) {
      return byUrl;
    }

    return null;
  }

  // =========================
  // 处理 [[xxx]]
  // =========================

  const walker =
    document.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT
    );

  const nodes = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;

    if (!parent) {
      continue;
    }

    if (
      parent.closest(
        "a, pre, code, script, style, textarea"
      )
    ) {
      continue;
    }

    if (node.nodeValue.includes("[[")) {
      nodes.push(node);
    }
  }

  nodes.forEach(node => {
    const text = node.nodeValue;

    const regex =
      /\[\[([^\]|#]+)?(?:#\^([A-Za-z0-9_-]+))?(?:\|([^\]]+))?\]\]/g;

    if (!regex.test(text)) {
      return;
    }

    regex.lastIndex = 0;

    const fragment =
      document.createDocumentFragment();

    let lastIndex = 0;
    let match;

    while (
      (match = regex.exec(text)) !== null
    ) {

      // 普通文字
      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(
            text.slice(
              lastIndex,
              match.index
            )
          )
        );
      }

      const pageName =
        match[1]?.trim() || null;

      const blockId =
        match[2]?.trim() || null;

      const customText =
        match[3]?.trim() || null;

      const linkText =
        customText ||
        pageName ||
        blockId ||
        "";

      const link =
        document.createElement("a");

      link.textContent =
        linkText;

      // =========================
      // 当前文章 Block
      // [[#^a4e2d5]]
      // =========================

      if (!pageName && blockId) {

        link.href =
          `#${blockId}`;

      }

      // =========================
      // 其他文章
      // =========================

      else if (pageName) {

        const page =
          findPage(pageName);

        if (page) {

          let url =
            page.url;

          if (blockId) {
            url += `#${blockId}`;
          }

          link.href =
            url;

          console.log(
            `Obsidian Wiki Link：${pageName} → ${url}`
          );

        } else {

          // =========================
          // 最终备用方案
          //
          // [[安装R语言]]
          // ↓
          // /posts/安装R语言/
          // =========================

          let fallbackUrl =
            `/posts/${encodeURIComponent(
              pageName
            )}/`;

          if (blockId) {
            fallbackUrl +=
              `#${blockId}`;
          }

          link.href =
            fallbackUrl;

        }
      }

      fragment.appendChild(link);

      lastIndex =
        regex.lastIndex;
    }

    // 最后的普通文字
    if (lastIndex < text.length) {
      fragment.appendChild(
        document.createTextNode(
          text.slice(lastIndex)
        )
      );
    }

    node.parentNode.replaceChild(
      fragment,
      node
    );
  });

  console.log(
    `Obsidian Wiki Link：扫描完成，共 ${pages.length} 个 Hugo 页面`
  );
});