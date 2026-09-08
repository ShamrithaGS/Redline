function isOnlineMode() {
  return process.env.ONLINE_MODE === 'true' && Boolean(process.env.GEMINI_API_KEY);
}

module.exports = { isOnlineMode };