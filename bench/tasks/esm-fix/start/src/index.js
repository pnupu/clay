const { formatReport } = require('./format');
import { loadSales } from './data';

const sales = loadSales();
console.log(formatReport(sales, { currency: 'EUR' }));
