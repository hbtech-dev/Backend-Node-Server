const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    fullName: {
      type: String,
      trim: true
    },
    companyName: {
      type: String,
      trim: true,
      default: ''
    },
    streetName: {
      type: String,
      trim: true,
      default: ''
    },
    houseNumber: {
      type: String,
      trim: true,
      default: ''
    },
    postcode: {
      type: String,
      trim: true,
      default: ''
    },
    cityName: {
      type: String,
      trim: true,
      default: ''
    },
    contactEmail: {
      type: String,
      trim: true,
      default: ''
    },
    telephone: {
      type: String,
      trim: true,
      default: ''
    },
    balance: {
      type: Number,
      default: 0.00
    },
    accountType: {
      type: String,
      enum: ['standard', 'premium'],
      default: 'standard'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },
    temuIntegration: {
      isConnected: { type: Boolean, default: false },
      appKey: { type: String, default: '' },
      appSecret: { type: String, default: '' },
      sellerId: { type: String, default: '' },
      shopName: { type: String, default: '' },
      lastSyncedAt: { type: Date, default: null }
    },
    ebayIntegration: {
      isConnected: { type: Boolean, default: false },
      appId: { type: String, default: '' },
      certId: { type: String, default: '' },
      devId: { type: String, default: '' },
      userToken: { type: String, default: '' },
      storeName: { type: String, default: '' },
      lastSyncedAt: { type: Date, default: null }
    },
    dhlIntegration: {
      isConnected: { type: Boolean, default: false },
      apiKey: { type: String, default: '' },
      apiSecret: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      isSandbox: { type: Boolean, default: true },
      productType: { type: String, default: 'V01PAK' },
      lastTestedAt: { type: Date, default: null }
    },
    fedexIntegration: {
      isConnected: { type: Boolean, default: false },
      apiKey: { type: String, default: '' },
      apiSecret: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      meterNumber: { type: String, default: '' },
      serviceType: { type: String, default: 'INTERNATIONAL_PRIORITY' },
      lastTestedAt: { type: Date, default: null }
    },
    settings: {
      standardValues: {
        defWeight: { type: String, default: '0.5' },
        defLength: { type: String, default: '30' },
        defWidth: { type: String, default: '20' },
        defHeight: { type: String, default: '15' }
      },
      deliveryNotes: {
        showLogo: { type: Boolean, default: true },
        showReturnLabel: { type: Boolean, default: false },
        includePackingList: { type: Boolean, default: true }
      },
      printSettings: {
        labelFormat: { type: String, default: 'A4' },
        printerType: { type: String, default: 'Laser' }
      },
      processingNumbers: {
        numPrefix: { type: String, default: 'PO-' },
        nextNum: { type: String, default: '10001' }
      }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual('items', {
  ref: 'Item',
  localField: '_id',
  foreignField: 'owner'
});

const User = mongoose.model('User', userSchema);

module.exports = User;
