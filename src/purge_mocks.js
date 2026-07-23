const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const TemuOrder = require('./models/temuOrder.model');

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/shipstation');
    console.log('Connected to MongoDB');

    // Delete the mock Spain order
    const result = await TemuOrder.deleteOne({ orderNum: 'PO-186-03626858276474079' });
    console.log(`Deleted mock order: ${result.deletedCount} matching documents.`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
