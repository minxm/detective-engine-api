'use strict';

/** SCF 运行时通过 require 加载入口，需用 CJS 包装 ESM 模块。文件须位于 zip 根目录。 */
exports.main = async (event, context) => {
  const mod = await import('./cloud-functions/index.js');
  const handler = mod.main ?? mod.default;
  if (typeof handler !== 'function') {
    throw new Error('ESM handler export not found in cloud-functions/index.js');
  }
  return handler(event, context);
};
