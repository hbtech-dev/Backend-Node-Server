const mongoose = require('mongoose');
require('dotenv').config({ path: 'd:/Eder-app/Backedn/Backend-Node-Server/.env' });
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function check() {
  await mongoose.connect(uri);
  const TemuOrder = mongoose.model('TemuOrder', new mongoose.Schema({}, { strict: false }));
  const packetaOrders = await TemuOrder.find({
    tracking: { $regex: '^Z', $options: 'i' },
    isDispatched: { $ne: true }
  }).select('name orderNum tracking carrierStatus shippedAt createdAt');
  console.log('All Packeta non-dispatched:', packetaOrders);
  await mongoose.disconnect();
}
check();
