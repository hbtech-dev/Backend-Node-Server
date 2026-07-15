jest.mock('mongoose', () => {
  const connect = jest.fn().mockRejectedValue(new Error('db down'));
  const connection = {
    on: jest.fn()
  };

  return {
    connect,
    connection
  };
});

describe('MongoDB connection setup', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.MONGODB_URI = 'mongodb://mongo:27017/test';
  });

  it('should not exit the process when the database connection fails', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) );

    const connectDB = require('../src/config/database');

    await expect(connectDB()).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
