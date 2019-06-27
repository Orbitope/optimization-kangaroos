import { Infinity, random, sin, cos, sqrt, pow, PI } from 'mathjs'
import { eval_funcs } from './functions'

/** Normalize any vector to unit length. */
function unit_normalize(x, y) {
  const c = sqrt(pow(x, 2) + pow(y, 2));
  return [x / c, y / c];
}

/** Sample vector from unit circle. */
function rand_unit_vector() {
  const a = random() * 2 * PI;
  return [cos(a), sin(a)];
}

/** Scale a value on a 0-1 scale to the 
 * appropriate value between a lower and
 * upper bound.
 */
function scale(n, lb, ub) {
    return lb + (ub - lb) * n;
}

/** Abstract class of the general optimize pattern
 * that will be followed by specific optimizers.
 * Mostly just used to organize my thoughts.
 */
class Optimizer {

    constructor(evalFunc, maxSteps, tol) {
        this.setState(evalFunc, maxSteps, tol);
    }

    /** Initializes the state of the optimizer with the evaluation
     * function, max steps, tolerance, and other algorithm specific
     * parameters. Called in constructor and for parameter changes.
     * @param {EvalFunction} evalFunc The evaluation function to optimize.
     * @param {*} maxSteps Maximum number of steps.
     * @param {*} tol Tolerance level of maximum change between steps 
     *      allowed before terminating optimization.
     */
    setState(evalFunc, maxSteps, tol) {
        this.evalFunc = evalFunc;
        this.maxSteps = maxSteps;
        this.max_value = -math.Infinity
        this.tol = tol; // Change this to be based on domain of evalFunc?
        this.complete = false;
        this.state = this.initialRandomState();

    }

    get state() {
        return this.state;
    }

    /** Initialize the state randomly within the evalFunc bounds. */
    initialRandomState() {
        return;
    }

    /** Step the optimization algorithm one iteration forwards.
     * @returns {Float32Array} New set of location(s)
     * @returns {float} New set of location evaluation function values
     * @returns {boolean} Indicator of whether the optimizer has converged or 
     *      has reached the maximum number of steps.
     */
    step() {
        if (!this.complete) {
            this.updateState();
        }

        func_value = this.evalFunc.getValue(this.state);
        return [this.state, func_value, this.complete];
    }

    updateState() {
    }

    findNeighbor() {
    }
    
    acceptNeighbor() {
    }


}

/** Simple optimization algorith that, at each step,
 * selects a random location, and if that location is 
 * equal to or higher than the current location, it moves
 * to the new location.
 * @extends Optimizer
 */
class HillClimber extends Optimizer {

    constructor(evalFunc, maxSteps, tol, stepSize, stepDecay) {
        this.setState(evalFunc, maxSteps, tol, stepSize, stepDecay);
    }

    /** Initializes the state of the optimizer with the evaluation
     * function, max steps, tolerance, and other algorithm specific
     * parameters. Called in constructor and for parameter changes.
     * @param {EvalFunction} evalFunc The evaluation function to optimize.
     * @param {int} maxSteps Maximum number of steps.
     * @param {float} tol Tolerance level of maximum change between steps 
     *      allowed before terminating optimization.
     * @param {float} stepSize The length of the vector to evaluate
     *      neighbors at for each step.
     * @param {float} stepDecay The amount to reduce the stepSize parameter
     *      after each step. Stops optimization when stepSize <= 0.
     */
    setState(evalFunc, maxSteps, tol, stepSize, stepDecay=0.0) {
        this.evalFunc = evalFunc;
        this.maxSteps = maxSteps;
        this.tol = tol; // Change this to be based on domain of evalFunc?
        this.complete = false;
        this.state = this.initialRandomState();
        this.stepSize = stepSize;
        this.stepDecay = stepDecay;
        this.value = this.evalFunc(this.state.x, this.state.y);
        this.max_value = this.evalFunc(this.state);;
    }

    /** Initialize the state randomly within the evalFunc bounds. */
    initialRandomState() {
        const evalDomain = this.evalFunc.domain;
        const x_value = scale(random(), evalDomain[0], evalDomain[1]);
        const y_value = scale(random(), evalDomain[0], evalDomain[1]);
        return {x: x_value, y: y_value};
    }

    /** Step the optimization algorithm one iteration forwards.
     * @returns {Float32Array} New set of location(s)
     * @returns {float} New set of location evaluation function values
     * @returns {boolean} Indicator of whether the optimizer has converged or 
     *      has reached the maximum number of steps.
     */
    step() {

        func_value = this.evalFunc(this.state);
        return [this.state, func_value, this.complete];
    }

    findNeighbor() {
      var [x, y] = rand_unit_vector()
      x *= this.stepSize;
      y *= this.stepSize;
      
      return [x, y];
    }
    
    acceptNeighbor() {
      const [x, y] = this.findNeighbor()
      if (this.evalFunc.isInDomain(x, y)) {
        if (this.evalFunc.getValue(x, y) >= this.value) {
          return true;
        }
      }
      return false;
    }
}