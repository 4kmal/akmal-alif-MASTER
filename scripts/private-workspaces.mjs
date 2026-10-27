export function isPrivateWorkspaceUrl(value = '') {
  let pathname = value.split('?')[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    } catch { return true; }
  }
  pathname = pathname.replaceAll('\\', '/').toLowerCase();
  return /(?:^|\/)events\/judging(?:\/|$)/.test(pathname)
    || /(?:^|\/)repo-reference(?:\/|$)/.test(pathname);
}

export function privateWorkspaceGuard(req, res, next) {
  if (!isPrivateWorkspaceUrl(req.url)) return next();
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end('Not found');
}
