module('BD');

test('Pluralizer', function() {
    equal(BD.pluralize('invoice'), 'invoices');
    equal(BD.pluralize('invoiceLine'), 'invoiceLines');
    equal(BD.pluralize('country'), 'countries');
    equal(BD.pluralize('currency'), 'currencies');
    equal(BD.pluralize('access'), 'accesses');
});

test('Singulizer', function() {
    equal(BD.singularize('invoices'), 'invoice');
    equal(BD.singularize('invoiceLines'), 'invoiceLine');
    equal(BD.singularize('countries'), 'country');
    equal(BD.singularize('currencies'), 'currency');
    equal(BD.singularize('accesses'), 'access');
});