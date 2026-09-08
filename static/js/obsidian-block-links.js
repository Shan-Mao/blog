document.addEventListener("DOMContentLoaded", () => {
  // =========================
  // 找到文章正文
  // =========================

  const content =
    document.querySelector(".single-post") ||
    document.querySelector(".post-content") ||
    document.querySelector("article") ||
    document.querySelector("main");

  if (!content) {
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
      pages = JSON.parse(
        pageData.textContent || "[]"
      );
    } catch (error) {
      console.error(
        "Obsidian Wiki Link：Hugo 页面列表解析失败",
        error
      );

      pages = [];
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
  // Hugo URL 编码
  // =========================

  function encodePathName(value) {
    return encodeURIComponent(
      String(value || "").trim()
    );
  }

  // =========================
  // 寻找文章
  // =========================

  function findPage(name) {
    const target = normalize(name);

    // -------------------------
    // 1. 文件名 / 名称 / 标题 / slug
    // -------------------------

    const page =
      pages.find((page) => {
        return [
          page.fileName,
          page.name,
          page.title,
          page.slug
        ].some((value) => {
          return normalize(value) === target;
        });
      }) || null;

    if (page) {
      return page;
    }

    // -------------------------
    // 2. 根据 URL 最后一段寻找
    // -------------------------

    const byUrl =
      pages.find((page) => {
        if (!page.url) {
          return false;
        }

        const cleanUrl =
          String(page.url)
            .replace(/\/+$/, "");

        const lastPart =
          cleanUrl
            .split("/")
            .pop();

        return (
          normalize(lastPart) === target
        );
      }) || null;

    return byUrl;
  }

  // =========================
  // 生成备用文章地址
  // =========================

  function createFallbackUrl(
    pageName,
    blockId,
    heading
  ) {
    let url =
      `/posts/${encodePathName(
        pageName.toLowerCase()
      )}/`;

    // -------------------------
    // Block ID
    // -------------------------

    if (blockId) {
      url += `#${encodeURIComponent(
        blockId
      )}`;
    }

    // -------------------------
    // 标题
    // -------------------------

    else if (heading) {
      url += `#${encodeURIComponent(
        heading.trim()
      )}`;
    }

    return url;
  }

  // =========================
  // 创建链接
  // =========================

  function createLink(
    pageName,
    heading,
    blockId,
    customText
  ) {
    const link =
      document.createElement("a");

    // =========================
    // 当前文章 Block
    // [[#^abc123]]
    // =========================

    if (!pageName && blockId) {
      link.href =
        `#${encodeURIComponent(
          blockId
        )}`;

      link.textContent =
        customText ||
        blockId;

      return link;
    }

    // =========================
    // 当前文章标题
    // [[#标题]]
    // =========================

    if (!pageName && heading) {
      link.href =
        `#${encodeURIComponent(
          heading.trim()
        )}`;

      link.textContent =
        customText ||
        heading;

      return link;
    }

    // =========================
    // 其他文章
    // =========================

    if (pageName) {
      const page =
        findPage(pageName);

      // -------------------------
      // 找到了 Hugo 页面
      // -------------------------

      if (page && page.url) {
        let url =
          String(page.url);

        // 确保 URL 末尾有 /
        if (!url.endsWith("/")) {
          url += "/";
        }

        // -----------------------
        // Block ID
        // -----------------------

        if (blockId) {
          url +=
            `#${encodeURIComponent(
              blockId
            )}`;
        }

        // -----------------------
        // 标题
        // -----------------------

        else if (heading) {
          url +=
            `#${encodeURIComponent(
              heading.trim()
            )}`;
        }

        link.href = url;

        link.textContent =
          customText ||
          pageName;

        return link;
      }

      // -------------------------
      // Hugo 页面没有找到
      // 使用备用路径
      // -------------------------

      link.href =
        createFallbackUrl(
          pageName,
          blockId,
          heading
        );

      link.textContent =
        customText ||
        pageName;

      return link;
    }

    // =========================
    // 理论上的兜底
    // =========================

    link.textContent =
      customText ||
      heading ||
      blockId ||
      "";

    return link;
  }

  // =========================
  // 扫描文章正文
  // =========================

  const walker =
    document.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT
    );

  const nodes = [];

  while (walker.nextNode()) {
    const node =
      walker.currentNode;

    const parent =
      node.parentElement;

    if (!parent) {
      continue;
    }

    // -------------------------
    // 不处理这些元素里的内容
    // -------------------------

    if (
      parent.closest(
        "a, pre, code, script, style, textarea"
      )
    ) {
      continue;
    }

    if (
      node.nodeValue &&
      node.nodeValue.includes("[[")
    ) {
      nodes.push(node);
    }
  }

  // =========================
  // 处理 Wiki Link
  // =========================

  nodes.forEach((node) => {
    const text =
      node.nodeValue || "";

    /*
      支持：

      [[文章]]

      [[文章|显示文字]]

      [[文章#标题]]

      [[文章#标题|显示文字]]

      [[文章#^块ID]]

      [[文章#^块ID|显示文字]]

      [[#标题]]

      [[#^块ID]]

    */

    const regex =
      /\[\[([^\]|#]+)?(?:#(\^)?([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

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
      // =========================
      // 前面的普通文字
      // =========================

      if (
        match.index >
        lastIndex
      ) {
        fragment.appendChild(
          document.createTextNode(
            text.slice(
              lastIndex,
              match.index
            )
          )
        );
      }

      // =========================
      // 解析 Wiki Link
      // =========================

      const pageName =
        match[1]?.trim() || null;

      const isBlock =
        Boolean(match[2]);

      const target =
        match[3]?.trim() || null;

      const customText =
        match[4]?.trim() || null;

      let heading = null;

      let blockId = null;

      // -------------------------
      // #^abc123
      // -------------------------

      if (isBlock) {
        blockId = target;
      }

      // -------------------------
      // #标题
      // -------------------------

      else if (target) {
        heading = target;
      }

      // =========================
      // 创建链接
      // =========================

      const link =
        createLink(
          pageName,
          heading,
          blockId,
          customText
        );

      fragment.appendChild(link);

      lastIndex =
        regex.lastIndex;
    }

    // =========================
    // 最后的普通文字
    // =========================

    if (
      lastIndex <
      text.length
    ) {
      fragment.appendChild(
        document.createTextNode(
          text.slice(
            lastIndex
          )
        )
      );
    }

    // =========================
    // 替换原文字节点
    // =========================

    if (node.parentNode) {
      node.parentNode.replaceChild(
        fragment,
        node
      );
    }
  });

  // =========================
  // 完成
  // =========================

  console.log(
    `Obsidian Wiki Link：扫描完成，共 ${pages.length} 个 Hugo 页面`
  );
});