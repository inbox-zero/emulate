export function sharePathForPathname(pathname: string): string {
  return `/f/${pathname.split("/").map(encodeURIComponent).join("/")}`;
}

export function pathnameFromShareSegments(pathname: string[]): string {
  return pathname.join("/");
}
