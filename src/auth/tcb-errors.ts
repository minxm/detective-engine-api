/** 将腾讯云 / CloudBase 接口错误转为中文提示 */
export function toChineseAuthError(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (!err) return fallback;

  const parts: string[] = [];
  if (typeof err === 'string') parts.push(err);
  else if (err instanceof Error) parts.push(err.message);
  else if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    for (const key of ['code', 'Code', 'message', 'Message', 'msg', 'error', 'Error']) {
      const val = o[key];
      if (typeof val === 'string' && val.trim()) parts.push(val.trim());
    }
  }

  const raw = parts.join(' ').trim();
  if (!raw) return fallback;

  const rules: Array<[RegExp, string]> = [
    [/provider email not found/i, '邮箱登录服务未配置，请使用用户名注册'],
    [/you must provide either an email or phone number/i, '注册请使用用户名或邮箱'],
    [/username.*exist|name.*exist|user.*exist|duplicate|already exist|resourceinuse|nameexist/i, '该账号已被注册'],
    [/配额|quota/i, '注册人数已达环境上限，请联系管理员或在 CloudBase 控制台升级套餐/清理测试账号'],
    [/invalid.*password|password.*invalid|password.*not.*meet/i, '密码不符合要求：需 8–32 位，且包含大小写字母、数字、特殊字符中的至少三项'],
    [/invalid.*name|invalid.*username|malformed.*name/i, '用户名格式不正确，需以字母或数字开头，仅可包含字母、数字、._-'],
    [/pure.*digit|纯数字/i, '用户名不能为纯数字'],
    [/unauthorized|permission denied|auth failure/i, '服务鉴权失败，请稍后重试'],
    [/rate limit|too many/i, '请求过于频繁，请稍后再试'],
    [/network|timeout|ECONNREFUSED|fetch failed/i, '网络异常，请稍后重试'],
  ];

  for (const [pattern, zh] of rules) {
    if (pattern.test(raw)) return zh;
  }

  if (/[\u4e00-\u9fff]/.test(raw)) return raw;
  return fallback;
}
