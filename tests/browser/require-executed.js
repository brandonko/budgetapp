// A green gate means every selected smoke test actually ran and passed.
class RequireExecuted {
  onBegin(_config, suite) { this.suite = suite; }

  onEnd() {
    const tests = this.suite?.allTests() || [];
    const incomplete = tests.filter(test => test.expectedStatus !== 'passed'
      || !test.results.length || test.results.some(result => result.status !== 'passed'));
    if (!tests.length || incomplete.length) {
      console.error('Browser verification requires passing, executed tests; skips and expected failures are not coverage.');
      return { status: 'failed' };
    }
  }
}

module.exports = RequireExecuted;
