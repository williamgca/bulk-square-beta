export default function isBuffer(obj) {
  return obj != null && (isModernBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer);
}

function isModernBuffer(obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === "function" && obj.constructor.isBuffer(obj);
}

function isSlowBuffer(obj) {
  return typeof obj.readFloatLE === "function" && typeof obj.slice === "function" && isModernBuffer(obj.slice(0, 0));
}
