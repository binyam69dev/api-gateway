class CircuitBreaker {
    constructor(serviceName, options = {}) {
        this.serviceName = serviceName;
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000;
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.nextAttemptTime = null;
    }

    async call(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() > this.nextAttemptTime) {
                this.state = 'HALF_OPEN';
                console.log(`🔓 Circuit ${this.serviceName} is HALF_OPEN`);
            } else {
                throw new Error(`Circuit ${this.serviceName} is OPEN`);
            }
        }

        try {
            const result = await fn();
            this.success();
            return result;
        } catch (error) {
            this.failure();
            throw error;
        }
    }

    success() {
        if (this.state === 'HALF_OPEN') {
            this.reset();
            console.log(`✅ Circuit ${this.serviceName} recovered`);
        }
        this.failureCount = 0;
    }

    failure() {
        this.failureCount++;
        if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttemptTime = Date.now() + this.resetTimeout;
            console.log(`❌ Circuit ${this.serviceName} OPEN`);
        } else if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            this.nextAttemptTime = Date.now() + this.resetTimeout;
        }
    }

    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.nextAttemptTime = null;
    }

    getState() {
        return { service: this.serviceName, state: this.state, failures: this.failureCount };
    }
}

module.exports = CircuitBreaker;
