import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleCrmPlan,simpleEmailQuery} from '../server/fast-plan.js';
test('common broad requests can avoid AI planning without removing named-entity filters',()=>{
 assert.equal(simpleCrmPlan('What are my recent projects?').table,'projects');assert.equal(simpleCrmPlan('Which tasks have upcoming deadlines?').dateMode,'upcoming');assert.equal(simpleCrmPlan('Show my overdue invoices').table,'invoices');assert.equal(simpleCrmPlan('Show recent projects for John Smith'),null);assert.equal(simpleCrmPlan('Show my projects at 123 Main Street'),null);
 assert.deepEqual(simpleEmailQuery('What needs my attention this week?','imap'),{query:''});assert.equal(simpleEmailQuery('Summarize my inbox','gmail').query,'in:inbox newer_than:7d');assert.equal(simpleEmailQuery('Summarize my emails from Maya','imap'),null);
});
