const admin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Нет прав администратора' });
  }
  next();
};

module.exports = admin;