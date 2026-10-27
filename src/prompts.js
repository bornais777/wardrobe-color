// ═══════════════════════════════════════════════════════
// 搭配分析提示词模块
// 设计原则：
//  1. 只写「变量 → 规则」，不放具体单品/发型举例（AI 会照抄）
//  2. 按用户输入只注入相关档位的规则，其余不出现
//  3. 未填写的变量一律跳过，不追问、不编造
// ═══════════════════════════════════════════════════════

export const GENDERS = [
  { id: "f", label: "女" },
  { id: "m", label: "男" },
];

export const SEASONS = [
  { id: "spring", label: "春" },
  { id: "summer", label: "夏" },
  { id: "autumn", label: "秋" },
  { id: "winter", label: "冬" },
];

export const SEASON_EN = { spring: "spring", summer: "summer", autumn: "autumn", winter: "winter" };

// 脸型：只写方向，不写具体发型/妆容
export const FACE_SHAPES = [
  { id: "round", label: "圆脸", rule: "目标：拉长并出棱角。竖线、斜线、有尖角的领型；顶部加高；避免圆弧齐下巴的轮廓。" },
  { id: "square", label: "方脸", rule: "目标：软化并上提。曲线、开口大的领型；发尾有弧度或层次；避免平直的下颌线。" },
  { id: "long", label: "长脸", rule: "目标：横向截断并补两侧量感。横线、圆润的领型；两侧要有体积。" },
  { id: "oval", label: "鹅蛋脸", rule: "均衡，少限制，以身高与风格为主导。" },
  { id: "heart", label: "心形脸", rule: "上宽下窄。补下半脸、减上半脸量感；领口与发量向下沉。" },
  { id: "diamond", label: "菱形脸", rule: "颧骨最宽。弱化颧骨，补额头和下颌；避免在侧面横向收紧。" },
  { id: "pear", label: "梨形脸", rule: "下宽上窄。补上半部分；肩部和顶部要有量感。" },
  { id: "wide", label: "方圆脸（宽而钝）", rule: "上提 + 外扩 + 长线条；用腰部或纵向线条做收束；避开与脸型同形的几何体。" },
];

const FACE_PRINCIPLE = `【脸型与重心原则】
不要按"某某脸适合某某发型/妆容"给答案，而是按形状关系推理。

第一步，判断三个维度：
- 纵横比：偏长 / 适中 / 偏宽
- 轮廓质感：棱角（下颌角、颧骨、额角明显）/ 圆润
- 重心位置：偏上（额头、颅顶宽）/ 偏中（颧骨宽）/ 偏下（下颌宽）

第二步，套用三条法则：
1. 重心对冲：重心偏下则视觉上提（加高颅顶、上扬线条、开口大的领型）；重心偏上则视觉下移（补下半脸或领口量感）。
2. 以形破形：避开与脸型同形的几何体，用相反形状。方、圆、宽用锐角、斜线、长线条；长脸用横线、圆润、分割。
3. 留白分配：宽而低折叠的脸向外延伸线条和五官；窄而高折叠的脸向内收，留出呼吸感。

法则作用于：领口形状、发型轮廓、整体廓形、配饰几何。`;

// ── 身高体重 ───────────────────────────────────────────
// 身高分档：女 <160 / 160–170 / >170；男 <170 / 170–180 / >180
export function bodyBuckets({ gender, height, weight }) {
  const h = Number(height) || 0;
  const w = Number(weight) || 0;
  let hb = null, wb = null, bmi = null;
  if (h > 0) {
    const [lo, hi] = gender === "m" ? [170, 180] : [160, 170];
    hb = h < lo ? "short" : h > hi ? "tall" : "mid";
  }
  if (h > 0 && w > 0) {
    bmi = w / Math.pow(h / 100, 2);
    wb = bmi < 18.5 ? "slim" : bmi <= 24 ? "mid" : "full";
  }
  return { hb, wb, bmi };
}

const HEIGHT_LABEL = { short: "偏矮", mid: "中等", tall: "偏高" };
const WEIGHT_LABEL = { slim: "纤细", mid: "匀称", full: "丰满" };

const HEIGHT_RULES = {
  short: `身高偏矮：求拉长、求聚焦
- 比例核心：上短下长，或上下同色成一条纵向柱
- 领口：开口大、能拉长颈部的形状
- 腰线：极高，视觉上腿从胸下开始
- 面料：轻、垂、顺滑，避免堆积
- 线条图案：纵向细线、小图案、同色系
- 避坑：上身长度落在身体正中、宽大袖型、截断腿线的鞋、局促的短下装`,
  mid: `身高中等：无明显短板，以脸型与风格为主导
- 只需避免在身体最宽处或腿线最长处做横向截断`,
  tall: `身高偏高：求气场、求平衡、求松弛
- 比例核心：上宽下松，或横向多层次分割
- 领口：有横向延展或体块的形状
- 腰线：自然位置，可用腰部装饰做分割
- 面料：有骨架、有重量、大块面
- 线条图案：宽横条、大图案、大色块拼接
- 避坑：无量感的细小装饰、过紧的短下装、五五分的上衣长度`,
};

const WEIGHT_RULES = {
  slim: `体型量感纤细：补量感
- 选有骨架的面料，可用层次和横向分割
- 避免过度贴身而塌陷`,
  mid: `体型量感匀称：不设限制`,
  full: `体型量感丰满：求流畅、求纵向
- 选垂坠且有骨架的面料，避免面料堆积和过紧
- 线条以纵向、斜向为主，上下身在腰部最窄处衔接`,
};

const GENDER_FOCUS = {
  f: "比例主线：腰线位置与上下身分割点；廓形可在 H / X / A / O 中选择。",
  m: "比例主线：肩线宽度、上衣长度落点与腿长的关系；腰部收束不作为主要手段，廓形以 H / A / O 为主。",
};

const BODY_OUTPUT = `必须输出：上下身分割点、上衣长度落点、下装长度落点、廓形及理由、鞋跟或鞋底高度范围、面料挺度方向。`;

// ── 季节 = 量感框架 ─────────────────────────────────────
const SEASON_RULES = {
  summer: `夏：低量感、高露肤。身体线条直接暴露，领口几何和腰线位置起决定作用；需要"硬结构"（挺括的剪裁）撑住轮廓。`,
  spring_autumn: `春秋：中量感、高可塑。外套敞开时，前襟形成两道平行的纵向线，视线沿中间的内搭向下走；系带或闭合时，改为腰部的收束线。`,
  winter: `冬：高量感、高包裹。外轮廓整体膨胀，头部下方的领口体块成为脸的"背景支架"。
- 身高偏矮或骨架小：内部收紧（高腰、窄柱体），外部放量
- 身高偏高或脸宽：可用大体块领口反衬脸部比例`,
};
const seasonRule = (id) =>
  id === "summer" ? SEASON_RULES.summer : id === "winter" ? SEASON_RULES.winter : SEASON_RULES.spring_autumn;

const HAIR_MODULE = `【发型推导】
把发型视为脸部的"外轮廓框"，用四个参数描述：
1. 顶部量感：高 / 平 / 低
2. 侧面量感：收 / 平 / 蓬
3. 发尾落点：额 / 颧 / 下颌线 / 肩 / 胸 / 腰
4. 线条走向：纵向 / 斜向 / 弧形 / 横向

推导规则（只依据下方已知条件，不考虑用户现有发型）：
- 脸部重心偏下或下颌量感大：顶部高、侧面收，发尾避开下颌线，走纵向或斜向
- 脸部纵向偏长：侧面蓬，发尾的横向量感落在颧骨至下颌区，走弧形或横向
- 脸部横向偏宽或偏圆：顶部高、侧面收，发尾不齐下巴，走纵向或斜向
- 脸型均衡：不设限制，由身高与风格主导
- 身高偏矮：控制头发总体积与长度，发尾不停在上身中段（会压缩上身）
- 身高偏高：发量与长度可放开，发尾可落在腰线附近
- 体型量感丰满：顶部略高，侧面不过蓬；纤细：侧面可蓬松
- 衔接领口：发尾落点不与领口边缘或肩线处于同一水平，除非目的就是横向截断

输出：四个参数的结论 + 一句原理。不输出具体发型名。`;

const GARMENT_MODULE = `【单品锚点】
用户自填的单品是搭配的锚点。逐件分析：
1. 几何与量感：领口/边缘形状、纵横张力、面料挺度与量感级别
2. 视线引导：视线焦点落在哪，对已知的脸型/身高分别起什么作用
3. 季节适配（已知季节时）：按季节量感框架判断是加分还是冲突
4. 配套：领口缓冲 + 下装几何 + 鞋靴延伸，每项带一句"为什么"
用户给了颜色就按该颜色分析；没给颜色则给 2–3 个色彩方向。`;

const FROM_IMAGE = "（未填写：请从上传图片中判断；图片中无法判断则跳过本模块）";

/**
 * 组装搭配分析提示词。
 * input: { gender, height, weight, faceId, season, garments:[{name,colorName}], enabled:{garment,season,body,face,hair}, hasImage, nl }
 * 返回 { system, user, modules } ；没有任何模块生效时返回 null（调用方跳过分析）
 */
export function buildAnalysisPrompt(input) {
  const { gender = "f", height, weight, faceId, season, garments = [], enabled = {}, hasImage = false, nl = "" } = input;
  const face = FACE_SHAPES.find((f) => f.id === faceId) || null;
  const items = garments.filter((g) => g.name && g.name.trim());
  const { hb, wb } = bodyBuckets({ gender, height, weight });
  const parts = [];
  const modules = [];

  // 脸型
  if (enabled.face) {
    if (face) {
      parts.push(`${FACE_PRINCIPLE}\n\n已填脸型：${face.label}\n方向：${face.rule}`);
      modules.push("脸型");
    } else if (hasImage) {
      parts.push(`${FACE_PRINCIPLE}\n\n脸型${FROM_IMAGE}\n脸型速查（仅作方向）：\n${FACE_SHAPES.map((f) => `- ${f.label}：${f.rule}`).join("\n")}`);
      modules.push("脸型");
    }
  }

  // 身高体重
  if (enabled.body) {
    const lines = [`【身高体重 → 比例与量感】`, `性别：${gender === "m" ? "男" : "女"}`, GENDER_FOCUS[gender === "m" ? "m" : "f"]];
    lines.push(`分工：身高决定比例与线条，体重决定量感与贴合度；两者独立判断后合并，冲突时比例优先于量感。体重不输出数值，不使用"显瘦""遮肉"等评价词。`);
    let ok = false;
    if (hb) {
      lines.push(`\n已知：身高${HEIGHT_LABEL[hb]}（${height}cm）\n${HEIGHT_RULES[hb]}`);
      ok = true;
    }
    if (wb) {
      lines.push(`\n已知：${WEIGHT_RULES[wb]}`);
      ok = true;
    }
    if (!ok && hasImage) {
      lines.push(`\n身高体重${FROM_IMAGE}\n身高档位规则：\n${Object.keys(HEIGHT_RULES).map((k) => HEIGHT_RULES[k]).join("\n")}\n体型量感规则：\n${Object.keys(WEIGHT_RULES).map((k) => WEIGHT_RULES[k]).join("\n")}`);
      ok = true;
    }
    if (ok) {
      lines.push(`\n${BODY_OUTPUT}`);
      parts.push(lines.join("\n"));
      modules.push("身高体重");
    }
  }

  // 发型：只由脸型/身高/体型推导
  if (enabled.hair) {
    const known = [];
    if (face) known.push(`脸型：${face.label}`);
    else if (enabled.face && hasImage) known.push("脸型：从上传图片判断");
    if (hb) known.push(`身高：${HEIGHT_LABEL[hb]}`);
    if (wb) known.push(`体型量感：${WEIGHT_LABEL[wb]}`);
    if (known.length) {
      parts.push(`${HAIR_MODULE}\n\n已知条件：\n${known.map((k) => `- ${k}`).join("\n")}\n未列出的条件视为未知，不做假设。`);
      modules.push("发型");
    }
  }

  // 季节
  if (enabled.season) {
    if (season) {
      parts.push(`【季节 = 量感框架】\n季节不只是温度，而是面料量感与包裹度的画布。\n${seasonRule(season)}`);
      modules.push("季节");
    } else if (hasImage) {
      parts.push(`【季节 = 量感框架】\n季节${FROM_IMAGE}\n${SEASON_RULES.summer}\n${SEASON_RULES.spring_autumn}\n${SEASON_RULES.winter}`);
      modules.push("季节");
    }
  }

  // 款式
  if (enabled.garment) {
    if (items.length) {
      parts.push(`${GARMENT_MODULE}\n\n用户单品：\n${items.map((g) => `- ${g.name.trim()}${g.colorName ? `（颜色：${g.colorName}）` : "（未指定颜色）"}`).join("\n")}`);
      modules.push("款式");
    } else if (hasImage) {
      parts.push(`${GARMENT_MODULE}\n\n用户单品${FROM_IMAGE.replace("请从上传图片中判断", "以上传图片中的主单品作为锚点")}`);
      modules.push("款式");
    }
  }

  if (!parts.length) return null;

  const system = `你是穿搭顾问，用"视线物理学 + 几何对冲"的方式分析搭配：按形状关系和视觉重心推理，不套"某某脸配某某款"的模板。

规则：
- 只使用下方已启用的模块；没有输入的变量一律不提，不追问，不编造。
- 文中所有举例仅用于说明原理，输出必须由输入变量推导，不得复用举例中的具体单品或发型。
- 每条建议带一句"为什么"，语气具体、可执行。

输出结构：
1. 一句话总评（抓住最关键的视觉矛盾或优势）
2. 已启用模块各一节，小节标题用模块名
3. 避坑 3 条

${parts.join("\n\n──────────\n\n")}`;

  const user = `请按已启用模块输出分析。${nl ? `\n用户补充描述：${nl}` : ""}${modules.length ? `\n已启用模块：${modules.join("、")}` : ""}`;

  return { system, user, modules };
}
