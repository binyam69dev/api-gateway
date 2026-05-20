const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
});

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register]
});

function recordRequest(method, route, status, durationMs) {
    httpRequestsTotal.inc({ method, route, status });
    httpRequestDuration.observe({ method, route }, durationMs / 1000);
}

async function getMetrics() {
    return register.metrics();
}

module.exports = { register, recordRequest, getMetrics };
