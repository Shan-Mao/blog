---
title: 安装R语言
date: 2026-09-08
tags:
  - 教程
categories:
  - R语言
---

不要从乱七八糟的网站下载。
直接使用 CRAN / 官方渠道。
Posit 的官方安装文档也明确建议从 CRAN 获取 R。
[R 官方下载入口（CRAN）](https://cran.r-project.org/?utm_source=chatgpt.com)

进入以后：
```
Download R for Windows
        ↓
base
        ↓
Download R-x.x.x for Windows
```

直接安装。

---

安装的时候怎么选？
基本上：
> **一路默认安装即可。**

尤其不要自己乱改：

```
32-bit
64-bit
PATH
Registry
etc.
```

现在 Windows 基本直接用 64 位。

**建议你把 R 的安装路径改到一个你自己管理的目录**，其他选项基本保持默认。

比如你可以这样：

```
D:\Software\R\
```

或者：

```
D:\Program Files\R\
```

最终类似：

```
D:\Software\R\R-4.x.x\
```

### 我建议这样选

|项目|建议|
|---|---|
|R 安装位置|✅ 可以改|
|32/64 位|✅ 默认|
|启动方式|✅ 默认|
|PATH|✅ 默认|
|注册表相关|✅ 默认|
|RStudio 安装位置|✅ 也可以改|
|R 包安装位置|⚠️ 暂时别改|

**最重要的是：不要把 R 安装到中文路径、带空格很多的奇怪路径或者 OneDrive 同步目录。**

例如：

```
D:\Software\R\       ✅
D:\R\                ✅
E:\Development\R\    ✅

D:\我的软件\R\       ❌ 不推荐
D:\OneDrive\R\       ❌ 不推荐
```

而且我们后面要让 **AI 自动调用 `Rscript.exe`**，所以路径完全可以自定义，只要之后把实际的 `Rscript.exe` 路径找出来即可。

例如你装成：

```
D:\Software\R\R-4.6.1\
```

那么大概率：

```
D:\Software\R\R-4.6.1\bin\R.exe
D:\Software\R\R-4.6.1\bin\Rscript.exe
```

后面 AI Runner 就可以直接调用它。