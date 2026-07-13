require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000), max: Number(process.env.RATE_LIMIT_MAX || 300) }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('tiny'));
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.use('/', require('./routes/auth'));
app.use('/superadmin', require('./routes/superadmin'));
app.use('/client', require('./routes/client'));
app.use('/tasks', require('./routes/tasks'));
app.use('/superadmin/internal-tasks', require('./routes/internalTasks'));
app.use('/qr-locations', require('./routes/qrLocations'));
app.use('/complaints', require('./routes/complaints'));
app.use('/analytics', require('./routes/analytics'));
app.use('/maintenance', require('./routes/maintenance'));
app.use('/security', require('./routes/security'));
app.get('/', (req, res) => res.redirect('/login'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Smart Data Task Management V7.3 Client Portal & Hierarchy Edition running on port ${PORT}`));
