// FastAPI sends `detail` as a plain string for a raised HTTPException, but
// as an array of {type, loc, msg, input} objects for a 422 request-validation
// error (e.g. a missing/invalid field). Passing that array straight into a
// toast or error banner crashes React ("Objects are not valid as a React
// child") instead of showing the user what went wrong.
export function getErrorMessage(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => d?.msg || String(d)).join('; ')
  }
  return err?.message || fallback
}
