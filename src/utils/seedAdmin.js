const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const User = require('../models/user.model');

async function seedAdmin() {
  try {
    const mongoUri = config.mongodb.url || process.env.MONGODB_URI;
    console.log('Connecting to MongoDB for Admin Setup...');
    await mongoose.connect(mongoUri, config.mongodb.options);
    console.log('MongoDB connected successfully.');

    const defaultAdminEmail = 'admin@ederapp.de';
    let admin = await User.findOne({ email: defaultAdminEmail });

    const allPages = [
      'stats', 'activity', 'open', 'labels', 'printed',
      'canceled', 'issues', 'trash', 'routing', 'inventory',
      'credit', 'invoices', 'settings'
    ];

    if (!admin) {
      console.log(`Creating default Agency Admin (${defaultAdminEmail})...`);
      admin = await User.create({
        email: defaultAdminEmail,
        password: 'Admin@Eder2026!',
        username: 'ederadmin',
        fullName: 'Agency Super Admin',
        companyName: 'EDER Agency HQ',
        balance: 1500.00,
        role: 'admin',
        accountType: 'premium',
        allowedPages: allPages,
        isActive: true,
        settings: {
          standardValues: { defWeight: '0.1', defLength: '30', defWidth: '20', defHeight: '15' }
        }
      });
      console.log('✅ Default Agency Admin created successfully!');
    } else {
      admin.role = 'admin';
      admin.allowedPages = allPages;
      admin.isActive = true;
      if (admin.balance === undefined || admin.balance === 0) {
        admin.balance = 1500.00;
      }
      // Reset password to ensure known credentials
      admin.password = 'Admin@Eder2026!';
      await admin.save();
      console.log('✅ Default Agency Admin refreshed & role verified.');
    }

    // Ensure all other users are strictly regular 'user' role
    await User.updateMany(
      { email: { $ne: defaultAdminEmail } },
      { $set: { role: 'user' } }
    );
    console.log('✅ Verified: only admin@ederapp.de has admin role. All others set to user.');

    console.log('\n--- ADMIN CREDENTIALS ---');
    console.log('Email:    admin@ederapp.de');
    console.log('Password: Admin@Eder2026!');
    console.log('Role:     admin');
    console.log('-------------------------\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Admin seed failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  seedAdmin();
}

module.exports = seedAdmin;

