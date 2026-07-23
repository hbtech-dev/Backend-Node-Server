const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('./models/user.model');
const TemuOrder = require('./models/temuOrder.model');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shipstation');
    console.log('Connected to MongoDB');

    const users = await User.find({});
    console.log(`Found ${users.length} user(s).`);
    for (const u of users) {
      console.log(`User: ${u.email}`);
      console.log(`- Legacy Conn: isConnected=${u.temuIntegration?.isConnected}, shopName=${u.temuIntegration?.shopName}, key=${u.temuIntegration?.appKey}`);
      console.log(`- Multi Conn (${u.temuIntegrations?.length || 0}):`);
      if (u.temuIntegrations) {
        u.temuIntegrations.forEach(i => {
          console.log(`  * shopName=${i.shopName}, sellerId=${i.sellerId}, isConnected=${i.isConnected}, key=${i.appKey}`);
        });
      }
    }

    const orders = await TemuOrder.find({});
    console.log(`\nFound ${orders.length} order(s) in DB:`);
    orders.forEach(o => {
      console.log(`- OrderNum: ${o.orderNum}, Goods: ${o.goodsName}, Country: ${o.countryCode}, status: ${o.status}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
