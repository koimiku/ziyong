export const BANGUMI_API_BASE = "https://api.bgm.tv/v0";

export const watchSources = [
  {
    id: "xfdm",
    name: "稀饭动漫",
    kind: "online",
    partition: "anime",
    searchUrl: (title) =>
      `https://dm1.xfdm.pro/search.html?wd=${encodeURIComponent(title)}`,
  },
  {
    id: "xgcartoon",
    name: "西瓜卡通",
    kind: "online",
    partition: "anime",
    searchUrl: (title) =>
      `https://www.xgcartoon.com/search?q=${encodeURIComponent(title)}`,
  },
  {
    id: "omofun",
    name: "Omofun",
    kind: "online",
    partition: "anime",
    searchUrl: (title) =>
      `https://omofun04.top/vod/search.html?wd=${encodeURIComponent(title)}`,
  },
  {
    id: "gugu",
    name: "咕咕番",
    kind: "online",
    partition: "anime",
    searchUrl: (title) =>
      `https://www.gugu3.com/index.php/vod/search.html?wd=${encodeURIComponent(title)}`,
  },
  {
    id: "mikan",
    name: "蜜柑计划",
    kind: "torrent",
    partition: "anime",
    searchUrl: (title) =>
      `https://mikanani.me/Home/Search?searchstr=${encodeURIComponent(title)}`,
  },
];

export const onlineSources = watchSources.filter((source) => source.kind === "online");
export const sourceNamesText = onlineSources.map((source) => source.name).join("、");

// 只填写你有权使用、且平台允许嵌入的播放器地址。
export const authorizedPlayers = [];

export const allowedEmbedHosts = new Set([
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "player.bilibili.com",
  "player.vimeo.com",
]);

export const fallbackAnime = [
  {
    id: 400602,
    title: "葬送のフリーレン",
    title_cn: "葬送的芙莉莲",
    title_synonyms: ["葬送的芙莉莲"],
    displayType: "TV",
    year: 2023,
    episodes: 28,
    score: 9.3,
    ratingTotal: 0,
    images: {
      large: "https://cdn.myanimelist.net/images/anime/1015/138006l.jpg",
      common: "https://cdn.myanimelist.net/images/anime/1015/138006.jpg",
    },
    synopsis:
      "勇者一行讨伐魔王后的旅途余温中，长寿精灵芙莉莲重新理解人类、记忆和告别。",
  },
  {
    id: 975,
    title: "One Piece",
    title_cn: "海贼王",
    title_synonyms: ["航海王", "海贼王"],
    displayType: "TV",
    year: 1999,
    episodes: null,
    score: 8.7,
    ratingTotal: 0,
    images: {
      large: "https://cdn.myanimelist.net/images/anime/6/73245l.jpg",
      common: "https://cdn.myanimelist.net/images/anime/6/73245.jpg",
    },
    synopsis:
      "路飞与伙伴们向着伟大航路前进，寻找传说中的大秘宝，并各自追逐自己的梦想。",
  },
  {
    id: 1428,
    title: "Fullmetal Alchemist: Brotherhood",
    title_cn: "钢之炼金术师 FULLMETAL ALCHEMIST",
    title_synonyms: ["钢之炼金术师FA", "钢炼FA"],
    displayType: "TV",
    year: 2009,
    episodes: 64,
    score: 9.1,
    ratingTotal: 0,
    images: {
      large: "https://cdn.myanimelist.net/images/anime/1208/94745l.jpg",
      common: "https://cdn.myanimelist.net/images/anime/1208/94745.jpg",
    },
    synopsis:
      "爱德华与阿尔冯斯兄弟在寻找贤者之石的旅程中，面对等价交换背后的真相。",
  },
];
