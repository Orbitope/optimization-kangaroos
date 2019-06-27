import { derivative, sin, cos, exp, sqrt, pow, abs, PI } from 'mathjs'

/** Class for holding different evaluation functions
 * and their associated domains and metadata.
 */
class EvalFunction {

    /** 
     * @param {*} f Function to optimize over that returns values
     *      based on x and y inputs. 
     * @param {*} f_str String representation of the prior function
     *      used to call mathjs derivative evaluation.
     * @param {*} name 
     * @param {*} domain 
     * @param {*} name 
     * @param {*} global_optimum 
     */
    constructor(f, f_str, name, domain, name, global_optimum=null) {
        this.f = f;
        this.f_str = f_str;
        this.domain = domain;
        this.name = name;
        this.global_optimum = global_optimum;
    }

    getValue(x, y) {
        return this.f(x, y);
    }

    getDerivative(x, y) {
        x_deriv =  derivative(this.f_str, 'x').evaluate({x: x})
        y_deriv =  derivative(this.f_str, 'x').evaluate({y: y})

        return [x_deriv, y_deriv];
    }

    isInDomain(x, y) {
      if (x < this.domain[0]) {
        return false;
      } else if (x > this.domain[1]) {
        return false;
      } else if (y < this.domain[0]) {
        return false;
      } else if (y > this.domain[1]) {
        return false;
      }
      return true;
    }

    get domain() {
        return this.domain;
    }

    get name() {
        return this.name;
    }
}

let ackley = EvalFunction(
    function(x, y) {
        return -1 * ((-20 * exp(-b * sqrt(1 / 2 * (pow(x, 2) + pow(y, 2))))) - exp(1 / 2 * (cos(x * 2 * PI) + cos(y * 2 * PI))) + 20 + exp(1));
    },
    '-1 * ((-20 * exp(-b * sqrt(1 / 2 * (pow(x, 2) + pow(y, 2))))) - exp(1 / 2 * (cos(x * 2 * PI) + cos(y * 2 * PI))) + 20 + exp(1))',
    'Ackley'
    [-32.768, 32.768]
    [0, 0]
);

let eggholder = EvalFunction (
    function(x, y) {
        return -1 * (-(y + 47) * sin(sqrt(abs(y + x / 2 + 47)) - x * sin(sqrt(abs(x - (y + 47))))));
    },
    '-1 * (-(y + 47) * sin(sqrt(abs(y + x / 2 + 47)) - x * sin(sqrt(abs(x - (y + 47))))))',
    'Eggholder',
    [-512, 512],
    [512, 404.2319]
);

let griewank = EvalFunction(
    function(x, y) {
        return (pow(x, 2) + pow(y, 2)) / 4000 - cos(x / sqrt(1)) - cos(y / sqrt(2)) + 1;
    },
    '(pow(x, 2) + pow(y, 2)) / 4000 - cos(x / sqrt(1)) - cos(y / sqrt(2)) + 1;',
    'Griewank',
    [0, 10],
    0
);

let schwefel = EvalFunction(
    function(x, y) {
        return 418.9829 * 2 - x * sin(sqrt(abs(x))) - y * sin(sqrt(abs(y)));
    },
    '418.9829 * 2 - x * sin(sqrt(abs(x))) - y * sin(sqrt(abs(y)))',
    'Schewefel',
    [-500, 500],
    [420.9687, 420.9687]
);

let shubert = EvalFunction(
    function(x, y) {
        let v1 = 0;
        let v2 = 0;
        for (let i = 1; i < 6; i++) {
            v1 += i * cos((i + 1) * x + i);
            v2 += i * cos((i + 1) * y + i);
        }
        return v1 * v2;
    }, 
    ['(',
     '1 * cos((1 + 1) * x + 1) + ',
     '2 * cos((2 + 1) * x + 2) + ',
     '2 * cos((3 + 1) * x + 3) + ',
     '2 * cos((4 + 1) * x + 4) + ',
     '2 * cos((5 + 1) * x + 5) + ',
     ') * (',
     '1 * cos((1 + 1) * y + 1) + ',
     '2 * cos((2 + 1) * y + 2) + ',
     '2 * cos((3 + 1) * y + 3) + ',
     '2 * cos((4 + 1) * y + 4) + ',
     '2 * cos((5 + 1) * y + 5) + ',
     ')'
    ].join(','),
    'Shubert',
    [-5.12, 5.12]
);

let himmelblau = EvalFunction(
    function(x, y) {
        return -1 * (pow(pow(x, 2) + y - 11, 2) + pow(x + pow(y, 2) - 7, 2))
    },
    '-1 * (pow(pow(x, 2) + y - 11, 2) + pow(x + pow(y, 2) - 7, 2))',
    'Himmelblau',
    [-5, 5]
);

const eval_funcs = [ackley, eggholder, griewank, schwefel, shubert, himmelblau];

export { eval_funcs };
