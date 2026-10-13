let provider = null;

// The desktop shell registers its verification session here, so rule requests
// carry the cookies a site hands out once the user passes its captcha.
export function setSiteCookieProvider(fn) {
  provider = typeof fn === "function" ? fn : null;
}

export async function siteCookieHeader(url) {
  if (!provider) return "";
  try {
    return String((await provider(url)) || "");
  } catch {
    return "";
  }
}
