const request = require('supertest');
const app = require('../src/app');

describe('Temu Endpoints', () => {
  it('should return health status for /api/v1/temu/health', async () => {
    const res = await request(app).get('/api/v1/temu/health');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('should return sampled products for /api/v1/temu/products', async () => {
    const res = await request(app).get('/api/v1/temu/products?keyword=wireless%20earbuds');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.products)).toBe(true);
  });
});
