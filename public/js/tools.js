/* ==========================================================
   更多工具 /tools/ 页面脚本
   只做两件事：
     1. 点左侧分类时平滑滚到对应分组（并同步地址栏 #hash）
     2. 滚动时高亮当前所在分类
   导航本身就是普通 <a href="#id">，JS 不生效也能正常跳转。
   ========================================================== */

(function () {
  "use strict";

  var nav = document.querySelector(".tools-nav");
  if (!nav) return;

  var links = Array.prototype.slice.call(nav.querySelectorAll("[data-tools-nav]"));
  if (!links.length) return;

  /* 把导航项和对应的分组绑在一起，找不到分组的直接跳过 */
  var sections = [];
  links.forEach(function (link) {
    var el = document.getElementById(link.getAttribute("data-tools-nav"));
    if (el) sections.push({ link: link, el: el });
  });
  if (!sections.length) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  /* 吸顶导航栏会挡住分组标题，滚动时留出它的高度。
     和 tools.css 里的 scroll-margin-top 保持一致 */
  function headerOffset() {
    var header = document.querySelector(".sticky-header");
    return (header ? header.offsetHeight : 0) + 24;
  }

  /* 移动端导航是一条横向滑动的行，高亮项要滑进可视范围。
     只改 nav.scrollLeft，不会带动整个页面滚动 */
  function revealLink(link) {
    if (nav.scrollWidth <= nav.clientWidth) return;
    var left = link.offsetLeft;
    var right = left + link.offsetWidth;
    if (left < nav.scrollLeft) {
      nav.scrollLeft = left - 8;
    } else if (right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = right - nav.clientWidth + 8;
    }
  }

  var activeLink = null;

  function setActive(link) {
    if (link === activeLink) return;
    if (activeLink) {
      activeLink.classList.remove("is-active");
      activeLink.removeAttribute("aria-current");
    }
    activeLink = link;
    if (activeLink) {
      activeLink.classList.add("is-active");
      activeLink.setAttribute("aria-current", "true");
      revealLink(activeLink);
    }
  }

  function update() {
    var threshold = headerOffset();
    var current = sections[0];

    for (var i = 0; i < sections.length; i++) {
      if (sections[i].el.getBoundingClientRect().top <= threshold) {
        current = sections[i];
      }
    }

    /* 滚到底部时锁定最后一组：最后一组内容少的时候永远滚不到阈值以上 */
    var doc = document.documentElement;
    if (window.innerHeight + window.pageYOffset >= doc.scrollHeight - 2) {
      current = sections[sections.length - 1];
    }

    setActive(current.link);
  }

  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      update();
    });
  }

  /* 点分类：滚到对应分组。不拦默认行为也能用，只是没有平滑效果 */
  links.forEach(function (link) {
    link.addEventListener("click", function (event) {
      var target = document.getElementById(link.getAttribute("data-tools-nav"));
      if (!target || event.metaKey || event.ctrlKey || event.shiftKey) return;

      event.preventDefault();

      window.scrollTo({
        top: window.pageYOffset + target.getBoundingClientRect().top - headerOffset(),
        behavior: reduceMotion && reduceMotion.matches ? "auto" : "smooth",
      });

      setActive(link);

      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "#" + link.getAttribute("data-tools-nav"));
      }
    });
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);

  update();
})();
