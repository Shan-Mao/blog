/* ==========================================================
   动态 Moments
   仅用于 /moments/ 页面（由 baseof.html 条件加载）

   数据来自现有 World App API：
   - 匿名读取时间线和公开图片
   - 登录后发布、上传图片、删除自己的动态
   - Token 只保存在当前页面内存中，不使用 localStorage / Cookie / URL
   ========================================================== */

(() => {
  "use strict";

  const app = document.getElementById("moments-app");
  if (!app) return;

  const DEFAULT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
  const PAGE_SIZE_MAX = 50;

  const dateFormatter = (() => {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return null;
    }
  })();

  const state = {
    baseUrl: "",
    pageSize: 10,
    maxImages: 4,
    maxUploadBytes: 10 * 1024 * 1024,
    maxContentLength: 5000,
    allowedTypes: new Set(DEFAULT_TYPES),

    accessToken: null,
    refreshToken: null,
    user: null,
    expiresIn: 0,
    authEpoch: 0,
    refreshPromise: null,

    cursor: null,
    hasMore: false,
    loading: false,
    loadPromise: null,
    infoReady: false,
    booting: false,

    selectedFiles: [],
    previews: [],
    pendingImageIds: [],
    pendingFileSignature: "",
    pendingSignature: "",
    pendingClientRequestId: null,

    submitting: false,
    loginBusy: false,
    logoutBusy: false,
    deleting: new Set(),
  };

  let el = null;

  class ApiError extends Error {
    constructor(status, code, message, details = null, requestId = "", retryAfter = "") {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
      this.requestId = requestId;
      this.retryAfter = retryAfter;
    }
  }

  /* ---------- 工具函数 ---------- */

  function normalizeBase(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";

    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      if (url.protocol === "http:" && !LOCAL_HOSTS.includes(url.hostname)) return "";
      if (url.username || url.password || url.search || url.hash) return "";

      let pathname = url.pathname.replace(/\/+$/, "");
      if (pathname === "/api" || pathname === "/api/v1") pathname = "";
      if (pathname) return "";

      return url.origin;
    } catch {
      return "";
    }
  }

  function safeImageUrl(raw) {
    if (typeof raw !== "string" || !raw) return null;

    try {
      const url = new URL(raw);
      if (url.username || url.password) return null;
      if (url.protocol === "https:") return url.href;
      if (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname)) return url.href;
      return null;
    } catch {
      return null;
    }
  }

  function normalizeType(type) {
    const value = String(type || "").toLowerCase();
    return value === "image/jpg" ? "image/jpeg" : value;
  }

  function typeLabel(type) {
    switch (type) {
      case "image/jpeg":
        return "JPEG";
      case "image/png":
        return "PNG";
      case "image/webp":
        return "WebP";
      case "image/gif":
        return "GIF";
      default:
        return type.replace(/^image\//, "").toUpperCase() || "图片";
    }
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "10 MB";
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }

  function formatDate(date) {
    if (dateFormatter) return dateFormatter.format(date);
    return date.toLocaleString("zh-CN");
  }

  function firstChar(name) {
    const chars = Array.from(String(name || "?").trim());
    return chars.length ? chars[0].toUpperCase() : "?";
  }

  function clampInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  }

  function positiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function randomId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20,
    )}-${hex.slice(20)}`;
  }

  /* ---------- API 客户端 ---------- */

  async function request(path, options = {}) {
    const opts = Object.assign(
      {
        method: "GET",
        auth: false,
        retry: true,
        allowAnonymousRetry: false,
      },
      options,
    );

    if (!state.baseUrl) {
      throw new ApiError(0, "NOT_CONFIGURED", "API 地址未配置。");
    }

    const headers = {};
    if (opts.auth && state.accessToken) {
      headers.Authorization = `Bearer ${state.accessToken}`;
    }

    let payload;
    if (opts.form) {
      payload = opts.form;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }

    let response;
    try {
      response = await fetch(`${state.baseUrl}/api/v1${path}`, {
        method: opts.method,
        headers,
        body: payload,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "网络请求失败。");
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const errorBody =
        data && typeof data === "object" && data.error && typeof data.error === "object"
          ? data.error
          : null;
      const code = errorBody && typeof errorBody.code === "string"
        ? errorBody.code
        : `HTTP_${response.status}`;
      const error = new ApiError(
        response.status,
        code,
        errorBody && typeof errorBody.message === "string"
          ? errorBody.message
          : `请求失败（${response.status}）`,
        errorBody && Array.isArray(errorBody.details) ? errorBody.details : null,
        errorBody && typeof errorBody.requestId === "string"
          ? errorBody.requestId
          : response.headers.get("X-Request-Id") || "",
        response.headers.get("Retry-After") || "",
      );

      if (response.status === 401 && opts.auth) {
        if (
          code === "UNAUTHORIZED" ||
          code === "SESSION_REVOKED" ||
          code === "INVALID_REFRESH_TOKEN"
        ) {
          clearSession("登录状态已失效，请重新登录。", false);
        } else if (code === "TOKEN_EXPIRED") {
          if (opts.retry && state.refreshToken) {
            const refreshed = await refreshSession();
            if (refreshed) {
              return request(path, Object.assign({}, opts, { retry: false }));
            }
          } else {
            clearSession("登录状态已失效，请重新登录。", false);
          }
        }

        if (opts.allowAnonymousRetry && !state.accessToken) {
          return request(
            path,
            Object.assign({}, opts, {
              auth: false,
              retry: false,
              allowAnonymousRetry: false,
            }),
          );
        }
      }

      throw error;
    }

    return data;
  }

  function refreshSession() {
    if (state.refreshPromise) return state.refreshPromise;
    if (!state.refreshToken || !state.baseUrl) return Promise.resolve(false);

    const epoch = state.authEpoch;
    const promise = (async () => {
      try {
        const response = await fetch(`${state.baseUrl}/api/v1/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: state.refreshToken }),
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });

        const text = await response.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
        }

        if (
          !response.ok ||
          !data ||
          typeof data.accessToken !== "string" ||
          typeof data.refreshToken !== "string"
        ) {
          throw new Error("refresh failed");
        }

        if (epoch !== state.authEpoch) return false;

        state.accessToken = data.accessToken;
        state.refreshToken = data.refreshToken;
        if (Number.isFinite(data.expiresIn)) state.expiresIn = data.expiresIn;
        return true;
      } catch {
        if (epoch === state.authEpoch) {
          clearSession("登录状态已失效，请重新登录。", false);
        }
        return false;
      }
    })();

    state.refreshPromise = promise;
    promise.finally(() => {
      if (state.refreshPromise === promise) state.refreshPromise = null;
    });

    return promise;
  }

  /* ---------- 会话与界面状态 ---------- */

  function clearSession(message = "", isError = false) {
    state.authEpoch += 1;
    state.accessToken = null;
    state.refreshToken = null;
    state.user = null;
    state.expiresIn = 0;
    state.refreshPromise = null;

    renderAuth();
    if (message) setStatus(message, isError);
  }

  function renderAuth() {
    const signedIn = Boolean(state.user);
    const name = signedIn && state.user.displayName ? state.user.displayName : "用户";

    el.loginForm.hidden = signedIn;
    el.account.hidden = !signedIn;
    el.composeForm.hidden = !signedIn;
    el.authState.textContent = signedIn ? `已登录：${name}` : "未登录";
    el.userName.textContent = signedIn ? name : "";
    refreshOwnershipUI();
  }

  function refreshOwnershipUI() {
    const canDelete = Boolean(state.user);
    const cards = el.timeline.querySelectorAll(".moments-card");

    cards.forEach((card) => {
      const button = card.querySelector(".moments-delete");
      if (!button) return;
      button.hidden = !(canDelete && card.dataset.mine === "true");
    });
  }

  function setStatus(message, isError = false) {
    el.status.textContent = message || "";
    el.status.classList.toggle("is-error", Boolean(message) && isError);
  }

  function setLoading(visible) {
    el.loading.hidden = !visible;
  }

  function showFatalError(message) {
    el.loading.hidden = true;
    el.error.textContent = message;
    el.error.hidden = false;
    el.retry.hidden = false;
    el.empty.hidden = true;
    el.more.hidden = true;
    el.timeline.setAttribute("aria-busy", "false");
  }

  function hideFatalError() {
    el.error.hidden = true;
    el.error.textContent = "";
    el.retry.hidden = true;
  }

  function setRefreshBusy(busy) {
    el.refresh.disabled = busy;
  }

  function setLoginBusy(busy) {
    el.loginBtn.disabled = busy;
    el.loginBtn.textContent = busy ? "登录中…" : "登录";
    el.email.disabled = busy;
    el.password.disabled = busy;
  }

  function setPublishBusy(busy) {
    el.publish.disabled = busy;
    el.publish.textContent = busy ? "发布中…" : "发布";
    el.files.disabled = busy;
    el.content.disabled = busy;
    el.previews.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
  }

  function updateCount() {
    const count = el.timeline.querySelectorAll(".moments-card").length;
    el.count.textContent = count > 0 ? `已显示 ${count} 条动态` : "";
  }

  function updateCounter() {
    const length = el.content.value.length;
    el.contentCount.textContent = String(length);
    el.contentCount.classList.toggle("is-over", length > state.maxContentLength);
  }

  function updateHints() {
    el.content.maxLength = state.maxContentLength;
    el.contentMax.textContent = String(state.maxContentLength);
    el.files.accept = Array.from(state.allowedTypes).join(",");

    const labels = Array.from(state.allowedTypes).map(typeLabel).join("、");
    el.filesHint.textContent = `支持 ${labels || "JPEG、PNG、WebP、GIF"}；单张不超过 ${formatBytes(
      state.maxUploadBytes,
    )}；最多 ${state.maxImages} 张。`;

    updateCounter();
  }

  function applyInfo(info) {
    const capabilities =
      info && info.capabilities && typeof info.capabilities === "object"
        ? info.capabilities
        : {};
    const imageCaps =
      capabilities.images && typeof capabilities.images === "object"
        ? capabilities.images
        : {};
    const limits = info && info.limits && typeof info.limits === "object" ? info.limits : {};

    state.maxImages = clampInt(imageCaps.maxPerMoment, state.maxImages, 1, 8);
    state.maxUploadBytes = positiveInt(limits.uploadMaxBytes, state.maxUploadBytes);
    state.maxContentLength = positiveInt(limits.contentMaxLength, state.maxContentLength);

    if (Array.isArray(imageCaps.types)) {
      const types = imageCaps.types
        .filter((type) => typeof type === "string" && type.indexOf("image/") === 0)
        .map(normalizeType);
      if (types.length) state.allowedTypes = new Set(types);
    }

    updateHints();
  }

  /* ---------- 错误提示 ---------- */

  function messageFor(error) {
    if (!(error instanceof ApiError)) {
      return "发生未知错误，请稍后重试。";
    }

    switch (error.code) {
      case "NETWORK_ERROR":
        return "无法连接 API。请检查网络；如果浏览器控制台提示 CORS，需要服务端允许当前站点 Origin。";
      case "INVALID_CREDENTIALS":
        return "邮箱或密码错误。";
      case "EMAIL_NOT_VERIFIED":
        return "请先完成邮箱验证，然后再发布或删除动态。";
      case "TOKEN_EXPIRED":
      case "SESSION_REVOKED":
      case "INVALID_REFRESH_TOKEN":
      case "UNAUTHORIZED":
        return "登录状态已失效，请重新登录。";
      case "RATE_LIMITED":
        return `请求过于频繁，请${
          error.retryAfter ? ` ${error.retryAfter} 秒后` : "稍后"
        }重试。`;
      case "PAYLOAD_TOO_LARGE":
        return "内容或图片超过大小限制。";
      case "UNSUPPORTED_MEDIA_TYPE":
        return "仅支持 JPEG、PNG、WebP、GIF 图片。";
      case "IMAGE_IN_USE":
      case "IMAGE_USED_AS_AVATAR":
        return "图片状态冲突，请重新选择图片。";
      case "FORBIDDEN":
        return "没有权限执行此操作。";
      case "NOT_FOUND":
        return "内容不存在，可能已被删除。";
      case "INCOMPATIBLE_SERVICE":
        return error.message || "API 服务不兼容。";
      case "BAD_RESPONSE":
        return error.message || "服务返回了无法识别的数据。";
      case "VALIDATION_ERROR": {
        if (Array.isArray(error.details) && error.details.length) {
          const details = error.details
            .map(
              (detail) =>
                `${detail && detail.field ? detail.field : "字段"} ${
                  detail && detail.message ? detail.message : "不合法"
                }`,
            )
            .join("；");
          return `提交内容校验失败：${details}`;
        }
        return "提交内容校验失败，请检查输入。";
      }
      default:
        if (error.status === 429) {
          return `请求过于频繁，请${
            error.retryAfter ? ` ${error.retryAfter} 秒后` : "稍后"
          }重试。`;
        }
        if (error.status >= 500) {
          return `服务暂时不可用，请稍后重试。${
            error.requestId ? `（请求 ID: ${error.requestId}）` : ""
          }`;
        }
        return error.message || "请求失败，请稍后重试。";
    }
  }

  /* ---------- 时间线读取 ---------- */

  async function waitForCurrentLoad() {
    if (state.loading && state.loadPromise) {
      try {
        await state.loadPromise;
      } catch {
        /* loadMoments 已处理错误 */
      }
    }
  }

  function loadMoments(reset = false) {
    if (state.loading) {
      return state.loadPromise || Promise.resolve(false);
    }

    state.loading = true;
    setRefreshBusy(true);
    el.timeline.setAttribute("aria-busy", "true");

    if (reset) {
      state.cursor = null;
      state.hasMore = false;
      el.timeline.replaceChildren();
      el.empty.hidden = true;
      el.more.hidden = true;
      hideFatalError();
      setStatus("");
      setLoading(true);
    } else {
      el.more.disabled = true;
      el.more.textContent = "加载中…";
    }

    const task = (async () => {
      try {
        setStatus("");

        const params = new URLSearchParams({ limit: String(state.pageSize) });
        if (!reset && state.cursor) params.set("cursor", state.cursor);

        const page = await request(`/moments?${params.toString()}`, {
          auth: Boolean(state.accessToken),
          allowAnonymousRetry: Boolean(state.accessToken),
        });

        if (!page || !Array.isArray(page.items)) {
          throw new ApiError(0, "BAD_RESPONSE", "动态列表响应格式不正确。");
        }

        if (reset) el.timeline.replaceChildren();

        page.items.forEach((moment) => {
          const card = renderMoment(moment);
          if (card && !findCard(moment.id)) el.timeline.append(card);
        });

        state.cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
        state.hasMore = Boolean(page.hasMore && state.cursor);

        el.more.hidden = !state.hasMore;
        el.empty.hidden = el.timeline.querySelector(".moments-card") !== null;
        updateCount();
        hideFatalError();
        return true;
      } catch (error) {
        if (reset) {
          showFatalError(messageFor(error));
        } else {
          setStatus(messageFor(error), true);
          el.more.hidden = !state.hasMore;
        }
        return false;
      } finally {
        state.loading = false;
        state.loadPromise = null;
        setLoading(false);
        el.timeline.setAttribute("aria-busy", "false");
        el.more.disabled = false;
        el.more.textContent = "加载更多";
        setRefreshBusy(false);
      }
    })();

    state.loadPromise = task;
    return task;
  }

  async function bootstrap() {
    if (state.booting) return;

    state.booting = true;
    state.infoReady = false;
    hideFatalError();
    setStatus("");
    setLoading(true);
    setRefreshBusy(true);

    try {
      const info = await request("/info", { auth: false });

      if (!info || info.service !== "world-app") {
        throw new ApiError(0, "INCOMPATIBLE_SERVICE", "该地址不是 world-app 服务。");
      }
      if (info.apiVersion !== "v1") {
        throw new ApiError(
          0,
          "INCOMPATIBLE_SERVICE",
          `API 版本不兼容：${info.apiVersion || "未知"}`,
        );
      }

      applyInfo(info);
      state.infoReady = true;
      await loadMoments(true);
    } catch (error) {
      setLoading(false);
      showFatalError(messageFor(error));
    } finally {
      state.booting = false;
      setRefreshBusy(false);
    }
  }

  /* ---------- 动态卡片渲染 ---------- */

  function findCard(id) {
    return (
      Array.from(el.timeline.children).find((card) => card.dataset.id === id) || null
    );
  }

  function renderMoment(moment, options = {}) {
    if (!moment || typeof moment.id !== "string" || !moment.id) return null;

    const eagerImages = options.eagerImages === true;
    const card = el.cardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = moment.id;
    card.dataset.mine = moment.mine === true ? "true" : "false";

    const author =
      moment.author && typeof moment.author === "object" ? moment.author : {};
    const name =
      typeof author.displayName === "string" && author.displayName.trim()
        ? author.displayName.trim()
        : "匿名";

    const authorName = card.querySelector(".moments-author-name");
    const avatarImage = card.querySelector(".moments-avatar-image");
    const avatarFallback = card.querySelector(".moments-avatar-fallback");
    const time = card.querySelector(".moments-time");
    const content = card.querySelector(".moments-content");
    const images = card.querySelector(".moments-images");
    const deleteButton = card.querySelector(".moments-delete");

    authorName.textContent = name;
    avatarFallback.textContent = firstChar(name);

    const avatarUrl = safeImageUrl(author.avatar && author.avatar.url);
    if (avatarUrl) {
      avatarImage.loading = eagerImages ? "eager" : "lazy";
      avatarImage.addEventListener(
        "error",
        () => {
          avatarImage.hidden = true;
          avatarFallback.hidden = false;
        },
        { once: true },
      );
      avatarImage.src = avatarUrl;
      avatarImage.hidden = false;
      avatarFallback.hidden = true;
    } else {
      avatarImage.hidden = true;
      avatarFallback.hidden = false;
    }

    const created = moment.createdAt ? new Date(moment.createdAt) : null;
    if (created && !Number.isNaN(created.getTime())) {
      time.dateTime = created.toISOString();
      time.textContent = formatDate(created);
      time.title = created.toLocaleString("zh-CN");
    } else {
      time.hidden = true;
    }

    const text = typeof moment.content === "string" ? moment.content : "";
    if (text.trim()) {
      content.textContent = text;
      content.hidden = false;
    }

    const momentImages = Array.isArray(moment.images)
      ? moment.images.slice(0, state.maxImages)
      : [];
    if (momentImages.length > 0) {
      images.dataset.count = String(momentImages.length);
      momentImages.forEach((image, index) => {
        images.append(createImageItem(image, index, momentImages.length));
      });
      images.hidden = false;
    }

    const canDelete = moment.mine === true && Boolean(state.user);
    deleteButton.hidden = !canDelete;
    if (canDelete) {
      deleteButton.addEventListener("click", () => {
        handleDelete(moment.id, card, deleteButton);
      });
    }

    return card;
  }

  function createImageItem(image, index, total) {
    const item = el.imageTemplate.content.firstElementChild.cloneNode(true);
    const img = item.querySelector("img");
    const alt = `动态图片 ${index + 1}/${total}`;

    img.alt = alt;
    // 动态卡片会在发布后插入到当前滚动位置上方；lazy 在该场景下
    // 可能不触发加载，因此动态图片统一立即加载（每条最多 4 张）。
    img.loading = "eager";
    item.setAttribute("aria-label", `查看大图：${alt}`);

    const url = safeImageUrl(image && image.url);
    if (!url) {
      markImageFallback(item, "图片地址无效");
      return item;
    }

    const width = Number(image.width);
    const height = Number(image.height);
    if (
      Number.isFinite(width) &&
      width > 0 &&
      Number.isFinite(height) &&
      height > 0 &&
      !(total === 3 && index === 0)
    ) {
      item.style.aspectRatio = `${width} / ${height}`;
    }

    img.addEventListener(
      "error",
      () => {
        markImageFallback(item, "图片加载失败");
      },
      { once: true },
    );

    img.src = url;
    item.addEventListener("click", () => openLightbox(url, alt));
    return item;
  }

  function markImageFallback(button, message) {
    button.classList.add("is-fallback");
    button.disabled = true;
    button.removeAttribute("aria-label");

    const fallback = document.createElement("span");
    fallback.className = "moments-image-fallback";
    fallback.textContent = message;
    button.replaceChildren(fallback);
  }

  function openLightbox(url, caption) {
    if (!el.lightbox || typeof el.lightbox.showModal !== "function") return;

    const safe = safeImageUrl(url);
    if (!safe) return;

    el.lightboxImage.hidden = false;
    el.lightboxImage.src = safe;
    el.lightboxImage.alt = caption;
    el.lightboxCaption.textContent = caption;

    if (!el.lightbox.open) {
      try {
        el.lightbox.showModal();
      } catch {
        /* 忽略无法打开对话框的环境 */
      }
    }
  }

  function prependMoment(moment) {
    const existing = findCard(moment.id);
    if (existing) existing.remove();

    const card = renderMoment(moment, { eagerImages: true });
    if (!card) return;

    el.timeline.prepend(card);
    hideFatalError();
    el.empty.hidden = true;
    updateCount();
  }

  async function handleDelete(momentId, card, button) {
    if (state.deleting.has(momentId)) return;
    if (!window.confirm("删除这条动态？关联图片也会一起删除，且不可恢复。")) return;

    state.deleting.add(momentId);
    button.disabled = true;
    button.textContent = "删除中…";

    try {
      await request(`/moments/${encodeURIComponent(momentId)}`, {
        method: "DELETE",
        auth: true,
        allowAnonymousRetry: false,
      });

      card.remove();
      updateCount();
      if (!el.timeline.querySelector(".moments-card")) el.empty.hidden = false;
      setStatus("已删除");
    } catch (error) {
      button.disabled = false;
      button.textContent = "删除";
      setStatus(messageFor(error), true);
    } finally {
      state.deleting.delete(momentId);
    }
  }

  /* ---------- 登录 ---------- */

  async function handleLogin(event) {
    event.preventDefault();
    if (state.loginBusy) return;

    const email = el.email.value.trim();
    const password = el.password.value;

    if (!email || email.indexOf("@") < 1) {
      setStatus("请输入有效邮箱。", true);
      return;
    }
    if (password.length < 8) {
      setStatus("密码至少 8 位。", true);
      return;
    }

    state.loginBusy = true;
    setLoginBusy(true);
    setStatus("");

    try {
      const session = await request("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
        retry: false,
      });

      if (
        !session ||
        typeof session.accessToken !== "string" ||
        typeof session.refreshToken !== "string" ||
        !session.user
      ) {
        throw new ApiError(0, "BAD_RESPONSE", "登录响应格式不正确。");
      }

      await discardPendingUploads();
      resetComposer();

      state.authEpoch += 1;
      state.refreshPromise = null;
      state.accessToken = session.accessToken;
      state.refreshToken = session.refreshToken;
      state.user = session.user;
      state.expiresIn = Number.isFinite(session.expiresIn) ? session.expiresIn : 0;

      el.loginForm.reset();
      el.password.value = "";
      renderAuth();
      el.authPanel.open = true;

      await waitForCurrentLoad();
      const ok = await loadMoments(true);
      setStatus(
        ok
          ? `登录成功：${session.user.displayName || "已登录"}`
          : "登录成功，但动态加载失败。",
        !ok,
      );
    } catch (error) {
      setStatus(messageFor(error), true);
    } finally {
      state.loginBusy = false;
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    if (state.logoutBusy || state.submitting) return;

    state.logoutBusy = true;
    el.logout.disabled = true;
    el.logout.textContent = "退出中…";
    setStatus("");

    let serverLogout = false;

    try {
      await discardPendingUploads();

      if (state.accessToken) {
        await request("/auth/logout", {
          method: "POST",
          auth: true,
          body: state.refreshToken ? { refreshToken: state.refreshToken } : undefined,
          retry: false,
          allowAnonymousRetry: false,
        });
        serverLogout = true;
      }
    } catch {
      /* 登出失败也要清空本地内存会话 */
    } finally {
      clearSession();
      resetComposer();
      el.authPanel.open = false;
      el.loginForm.reset();
      el.password.value = "";
      state.logoutBusy = false;
      el.logout.disabled = false;
      el.logout.textContent = "退出登录";

      await waitForCurrentLoad();
      const ok = await loadMoments(true);
      setStatus(
        ok
          ? serverLogout
            ? "已退出登录"
            : "已清除本地登录状态；服务端会话可能仍有效。"
          : "已退出登录，但动态加载失败。",
        !ok,
      );
    }
  }

  /* ---------- 发布 ---------- */

  function validateFile(file) {
    if (!file) return "图片无效。";
    if (file.size === 0) return "图片不能为空。";
    if (file.size > state.maxUploadBytes) {
      return `单张图片不能超过 ${formatBytes(state.maxUploadBytes)}。`;
    }

    const type = normalizeType(file.type);
    if (type && !state.allowedTypes.has(type)) {
      return `不支持的图片格式：${file.type || "未知"}。`;
    }

    return "";
  }

  function clearPreviewUrls() {
    state.previews.forEach((url) => URL.revokeObjectURL(url));
    state.previews = [];
  }

  function rebuildPreviews() {
    clearPreviewUrls();
    el.previews.replaceChildren();

    state.previews = state.selectedFiles.map((file) => URL.createObjectURL(file));

    state.previews.forEach((url, index) => {
      const file = state.selectedFiles[index];
      const figure = document.createElement("figure");
      figure.className = "moments-preview";

      const img = document.createElement("img");
      img.src = url;
      img.alt = `待发布图片 ${index + 1}`;
      img.loading = "lazy";
      img.decoding = "async";
      if (file && file.name) img.title = file.name;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "moments-preview-remove";
      remove.setAttribute("aria-label", `移除第 ${index + 1} 张图片`);
      remove.textContent = "×";
      remove.disabled = state.submitting;
      remove.addEventListener("click", () => removeSelectedFile(index));

      figure.append(img, remove);
      el.previews.append(figure);
    });

    el.previews.hidden = state.selectedFiles.length === 0;
  }

  function removeSelectedFile(index) {
    if (state.submitting) return;

    state.selectedFiles.splice(index, 1);
    void discardPendingUploads();
    state.pendingFileSignature = "";
    state.pendingSignature = "";
    state.pendingClientRequestId = null;

    if (state.selectedFiles.length === 0) el.files.value = "";
    rebuildPreviews();
    el.uploadStatus.textContent = state.selectedFiles.length
      ? `已选择 ${state.selectedFiles.length} 张图片。`
      : "";
    setStatus("");
  }

  function handleFileChange() {
    const files = Array.from(el.files.files || []);
    el.files.value = "";

    void discardPendingUploads();
    state.pendingFileSignature = "";
    state.pendingSignature = "";
    state.pendingClientRequestId = null;
    el.uploadStatus.textContent = "";

    if (files.length === 0) {
      state.selectedFiles = [];
      rebuildPreviews();
      return;
    }

    if (files.length > state.maxImages) {
      state.selectedFiles = [];
      rebuildPreviews();
      setStatus(`最多选择 ${state.maxImages} 张图片。`, true);
      return;
    }

    for (const file of files) {
      const issue = validateFile(file);
      if (issue) {
        state.selectedFiles = [];
        rebuildPreviews();
        setStatus(issue, true);
        return;
      }
    }

    state.selectedFiles = files;
    rebuildPreviews();
    el.uploadStatus.textContent = `已选择 ${files.length} 张图片。`;
    setStatus("");
  }

  async function discardPendingUploads() {
    const ids = state.pendingImageIds.slice();
    state.pendingImageIds = [];

    if (ids.length === 0 || !state.accessToken) return;

    await Promise.allSettled(
      ids.map((id) =>
        request(`/uploads/${encodeURIComponent(id)}`, {
          method: "DELETE",
          auth: true,
          retry: false,
          allowAnonymousRetry: false,
        }).catch(() => null),
      ),
    );
  }

  function resetComposer() {
    el.content.value = "";
    el.files.value = "";
    state.selectedFiles = [];
    clearPreviewUrls();
    el.previews.replaceChildren();
    el.previews.hidden = true;

    state.pendingImageIds = [];
    state.pendingFileSignature = "";
    state.pendingSignature = "";
    state.pendingClientRequestId = null;

    el.uploadStatus.textContent = "";
    updateCounter();
  }

  async function uploadFile(file) {
    const form = new FormData();
    form.append("file", file, file.name);

    const data = await request("/uploads", {
      method: "POST",
      form,
      auth: true,
      allowAnonymousRetry: false,
    });

    if (!data || !data.image || typeof data.image.id !== "string") {
      throw new ApiError(0, "BAD_RESPONSE", "图片上传响应格式不正确。");
    }

    return data.image.id;
  }

  async function handlePublish(event) {
    event.preventDefault();
    if (state.submitting) return;

    if (!state.user) {
      setStatus("请先登录。", true);
      return;
    }

    const content = el.content.value;
    const files = state.selectedFiles.slice();

    if (!content.trim() && files.length === 0) {
      setStatus("请输入正文或选择图片。", true);
      return;
    }
    if (content.length > state.maxContentLength) {
      setStatus(`正文不能超过 ${state.maxContentLength} 个字符。`, true);
      return;
    }
    if (files.length > state.maxImages) {
      setStatus(`最多上传 ${state.maxImages} 张图片。`, true);
      return;
    }

    for (const file of files) {
      const issue = validateFile(file);
      if (issue) {
        setStatus(issue, true);
        return;
      }
    }

    state.submitting = true;
    setPublishBusy(true);
    setStatus("");

    try {
      await waitForCurrentLoad();

      if (!state.user) {
        setStatus("登录状态已失效，请重新登录。", true);
        return;
      }

      const fileSignature = files
        .map((file) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`)
        .join("|");

      if (fileSignature !== state.pendingFileSignature) {
        void discardPendingUploads();
        state.pendingImageIds = [];
        state.pendingFileSignature = fileSignature;
        state.pendingSignature = "";
        state.pendingClientRequestId = null;
      }

      const attemptSignature = `${content}\u0000${fileSignature}`;
      if (attemptSignature !== state.pendingSignature) {
        state.pendingSignature = attemptSignature;
        state.pendingClientRequestId = null;
      }

      for (let index = state.pendingImageIds.length; index < files.length; index += 1) {
        el.uploadStatus.textContent = `正在上传第 ${index + 1}/${files.length} 张图片…`;
        const imageId = await uploadFile(files[index]);
        state.pendingImageIds.push(imageId);
      }

      el.uploadStatus.textContent = "图片上传完成，正在发布…";

      const clientRequestId = state.pendingClientRequestId || randomId();
      state.pendingClientRequestId = clientRequestId;

      const moment = await request("/moments", {
        method: "POST",
        auth: true,
        body: {
          content,
          imageIds: state.pendingImageIds.slice(),
          clientRequestId,
        },
        allowAnonymousRetry: false,
      });

      if (!moment || typeof moment.id !== "string") {
        throw new ApiError(0, "BAD_RESPONSE", "发布响应格式不正确。");
      }

      state.pendingImageIds = [];
      state.pendingFileSignature = "";
      state.pendingSignature = "";
      state.pendingClientRequestId = null;

      resetComposer();
      prependMoment(moment);
      setStatus("已发布");
      el.uploadStatus.textContent = "";
    } catch (error) {
      el.uploadStatus.textContent = "";
      setStatus(messageFor(error), true);
    } finally {
      state.submitting = false;
      setPublishBusy(false);
    }
  }

  /* ---------- 初始化 ---------- */

  function cacheDom() {
    const query = (selector) => app.querySelector(selector);

    el = {
      status: query("#moments-status"),
      count: query("#moments-count"),
      refresh: query("#moments-refresh"),
      authPanel: query("#moments-auth"),
      authState: query("#moments-auth-state"),
      loginForm: query("#moments-login-form"),
      email: query("#moments-email"),
      password: query("#moments-password"),
      loginBtn: query("#moments-login-btn"),
      account: query("#moments-account"),
      userName: query("#moments-user-name"),
      logout: query("#moments-logout"),
      composeForm: query("#moments-compose-form"),
      content: query("#moments-content"),
      contentCount: query("#moments-content-count"),
      contentMax: query("#moments-content-max"),
      files: query("#moments-files"),
      filesHint: query("#moments-files-hint"),
      previews: query("#moments-previews"),
      uploadStatus: query("#moments-upload-status"),
      publish: query("#moments-publish-btn"),
      loading: query("#moments-loading"),
      error: query("#moments-error"),
      retry: query("#moments-retry"),
      timeline: query("#moments-timeline"),
      empty: query("#moments-empty"),
      more: query("#moments-more"),
      cardTemplate: query("#moments-card-template"),
      imageTemplate: query("#moments-image-template"),
      lightbox: query("#moments-lightbox"),
      lightboxImage: query("#moments-lightbox-image"),
      lightboxCaption: query("#moments-lightbox-caption"),
      lightboxClose: query("#moments-lightbox-close"),
    };

    const required = [
      "status",
      "count",
      "refresh",
      "authPanel",
      "authState",
      "loginForm",
      "email",
      "password",
      "loginBtn",
      "account",
      "userName",
      "logout",
      "composeForm",
      "content",
      "contentCount",
      "contentMax",
      "files",
      "filesHint",
      "previews",
      "uploadStatus",
      "publish",
      "loading",
      "error",
      "retry",
      "timeline",
      "empty",
      "more",
      "cardTemplate",
      "imageTemplate",
      "lightbox",
      "lightboxImage",
      "lightboxCaption",
      "lightboxClose",
    ];

    if (required.some((key) => !el[key])) return false;
    if (!el.cardTemplate.content || !el.imageTemplate.content) return false;

    return true;
  }

  function bindEvents() {
    el.refresh.addEventListener("click", () => {
      if (state.infoReady) {
        void loadMoments(true);
      } else {
        void bootstrap();
      }
    });

    el.more.addEventListener("click", () => {
      if (state.infoReady) void loadMoments(false);
    });

    el.retry.addEventListener("click", () => {
      if (state.infoReady) {
        void loadMoments(true);
      } else {
        void bootstrap();
      }
    });

    el.loginForm.addEventListener("submit", handleLogin);
    el.logout.addEventListener("click", handleLogout);
    el.composeForm.addEventListener("submit", handlePublish);
    el.content.addEventListener("input", updateCounter);
    el.files.addEventListener("change", handleFileChange);

    el.lightboxClose.addEventListener("click", () => {
      if (el.lightbox.open) el.lightbox.close();
    });

    el.lightbox.addEventListener("click", (event) => {
      if (event.target === el.lightbox && el.lightbox.open) el.lightbox.close();
    });

    el.lightbox.addEventListener("close", () => {
      el.lightboxImage.removeAttribute("src");
      el.lightboxImage.hidden = false;
      el.lightboxCaption.textContent = "";
    });

    el.lightboxImage.addEventListener("error", () => {
      el.lightboxImage.hidden = true;
      el.lightboxCaption.textContent = "图片加载失败";
    });
  }

  function init() {
    if (!cacheDom()) return;

    bindEvents();

    const base = normalizeBase(app.dataset.apiBase);
    if (!base) {
      showFatalError("API 地址配置无效：请填写 https 根地址。");
      return;
    }

    state.baseUrl = base;
    state.pageSize = clampInt(app.dataset.pageSize, 10, 1, PAGE_SIZE_MAX);

    updateHints();
    renderAuth();
    void bootstrap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
