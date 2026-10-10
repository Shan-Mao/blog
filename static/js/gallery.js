/* ==========================================================
   画廊 Gallery —— 分类筛选 + 原生 <dialog> 大图查看器
   仅用于 /gallery/ 页面（由 baseof.html 条件加载）
   无任何第三方依赖
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("gallery-grid");
  const dialog = document.getElementById("gallery-lightbox");

  if (!grid || !dialog) {
    return;
  }

  const items = Array.from(grid.querySelectorAll(".gallery-item"));

  if (!items.length) {
    return;
  }

  // =========================
  // 灯箱元素
  // =========================

  const imageEl = dialog.querySelector("[data-lb-image]");
  const titleEl = dialog.querySelector("[data-lb-title]");
  const descEl = dialog.querySelector("[data-lb-desc]");
  const dateEl = dialog.querySelector("[data-lb-date]");
  const counterEl = dialog.querySelector("[data-lb-counter]");
  const prevBtn = dialog.querySelector("[data-lb-prev]");
  const nextBtn = dialog.querySelector("[data-lb-next]");
  const closeBtn = dialog.querySelector("[data-lb-close]");

  let current = 0;
  const preloaded = new Set();

  // =========================
  // 当前可见（未被筛选掉）的图片
  // =========================

  function visibleItems() {
    return items.filter((el) => !el.classList.contains("is-hidden"));
  }

  // =========================
  // 预加载相邻图片，避免翻页白屏
  // =========================

  function preload(figure) {
    const img = figure.querySelector("img");

    if (!img) return;

    const url = img.currentSrc || img.src;

    if (!url || preloaded.has(url)) return;

    preloaded.add(url);

    const pre = new Image();
    pre.src = url;
  }

  // =========================
  // 渲染第 index 张
  // =========================

  function render(index) {
    const list = visibleItems();

    if (!list.length) return;

    // 循环翻页
    current = ((index % list.length) + list.length) % list.length;

    const figure = list[current];
    const img = figure.querySelector("img");

    imageEl.src = img.currentSrc || img.src;
    imageEl.alt = img.alt || "";

    titleEl.textContent = figure.dataset.title || "";
    descEl.textContent = figure.dataset.description || "";
    dateEl.textContent = figure.dataset.date || "";
    counterEl.textContent = `${current + 1} / ${list.length}`;

    const single = list.length < 2;

    prevBtn.hidden = single;
    nextBtn.hidden = single;

    if (!single) {
      preload(list[(current + 1) % list.length]);
      preload(list[(current - 1 + list.length) % list.length]);
    }
  }

  // =========================
  // 打开 / 关闭
  // =========================

  function open(figure) {
    const list = visibleItems();
    const index = list.indexOf(figure);

    render(index < 0 ? 0 : index);

    // 原生 dialog 提供 Esc 关闭、焦点锁定和 ::backdrop
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    // 锁定页面滚动
    document.body.style.overflow = "hidden";
  }

  function close() {
    if (dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
      document.body.style.overflow = "";
    }
  }

  // =========================
  // 网格点击（事件委托）
  // =========================

  grid.addEventListener("click", (event) => {
    const figure = event.target.closest(".gallery-item");

    if (figure) {
      open(figure);
    }
  });

  // =========================
  // 按钮
  // =========================

  prevBtn.addEventListener("click", () => render(current - 1));
  nextBtn.addEventListener("click", () => render(current + 1));
  closeBtn.addEventListener("click", close);

  // 点击图片外的背景关闭
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
    }
  });

  dialog.addEventListener("close", () => {
    document.body.style.overflow = "";

    // 释放引用，下次打开不会闪上一张图
    imageEl.removeAttribute("src");
  });

  // =========================
  // 键盘：Esc 由浏览器处理，这里补左右方向键
  // =========================

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      render(current - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      render(current + 1);
    }
  });

  // =========================
  // 分类筛选
  // =========================

  const filterBtns = Array.from(document.querySelectorAll(".gallery-filter-btn"));

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.filter;

      filterBtns.forEach((other) => {
        const active = other === btn;

        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", active ? "true" : "false");
      });

      items.forEach((figure) => {
        const show = filter === "all" || figure.dataset.category === filter;

        figure.classList.toggle("is-hidden", !show);
      });
    });
  });
});
