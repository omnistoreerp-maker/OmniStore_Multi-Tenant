'use strict';

// Pipeline —— public barrel for the tenant identification pipeline.
//
// Exposes the pipeline classes and factory. Used by TenantResolver to remain
// decoupled from how tenants are identified.

const BaseIdentificationStep = require('./BaseIdentificationStep');
const StaticIdentificationStep = require('./StaticIdentificationStep');
const PipelineRegistry = require('./PipelineRegistry');
const TenantIdentificationPipeline = require('./TenantIdentificationPipeline');
const PipelineFactory = require('./PipelineFactory');

module.exports = Object.freeze({
  BaseIdentificationStep,
  StaticIdentificationStep,
  PipelineRegistry,
  TenantIdentificationPipeline,
  PipelineFactory
});