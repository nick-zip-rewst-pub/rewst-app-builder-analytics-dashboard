/**
 * Rewst App Builder Library
 * @fileoverview Simple utilities for creating and manipulating DOM elements
 * @author Nick Zipse <nick.zipse@rewst.com>
 * @version 4.2.0
 * 
 * A comprehensive JavaScript library for building custom apps in Rewst's App Builder.
 * Provides easy workflow execution, form submission, debugging tools, trigger analysis,
 * and form field conditional logic (show/hide based on other field values).
 *
 * Quick Start:
 *   const rewst = new RewstApp({ debug: true });
 *   await rewst.init();
 *   const result = await rewst.runWorkflowSmart('workflow-id', { input: 'data' });
 *   console.log(result.output);           // Output variables
 *   console.log(result.triggerInfo.type); // How it was triggered (Cron Job, Webhook, etc.)
 *
 * Get Recent Executions:
 *   const executions = await rewst.getRecentExecutions(true, 7);         // Last 7 days with trigger info
 *   const allExecs = await rewst.getRecentExecutions(true);              // All time with trigger info
 *   const noTrigger = await rewst.getRecentExecutions(false, 30);        // Last 30 days, no trigger info
 *   const workflowExecs = await rewst.getRecentExecutions(true, 7, 'wf-id');  // Specific workflow
 *   executions.forEach(e => console.log(`${e.workflow.name}: ${e.triggerInfo.type}`));
 *
 * Filter by Trigger Type:
 *   const cronJobs = await rewst.getExecutionsByTriggerType('Cron Job', 7);       // Last 7 days
 *   const allWebhooks = await rewst.getExecutionsByTriggerType('Webhook');        // All time
 *   const wfCrons = await rewst.getExecutionsByTriggerType('Cron Job', 30, 'wf-id'); // Specific workflow
 *   console.log(`Found ${cronJobs.length} cron job executions`);
 *
 * Get All Workflows:
 *   const workflows = await rewst.getAllWorkflows();
 *   workflows.forEach(w => console.log(`${w.name} - ${w.triggers.length} triggers`));
 *
 * Debug a Workflow:
 *   await rewst.debugWorkflow('workflow-id'); // Prints schema and triggers to console
 *
 * Get Org Variables:
 *   const apiKey = await rewst.getOrgVariable('api_key');
 *   console.log('API Key:', apiKey);
 *
 * Get Last Workflow Execution:
 *   const result = await rewst.getLastWorkflowExecution('workflow-id');
 *   console.log('Output:', result.output);
 *   console.log('Trigger:', result.triggerInfo.type);
 *
 * Submit a Form (Simple):
 *   await rewst.submitForm('form-id', { fieldName: 'value' }, 'trigger-id');
 *
 * Submit a Form (With Workflow Tracking):
 *   const result = await rewst.submitForm('form-id', { fieldName: 'value' }, 'trigger-id', {
 *     waitForCompletion: true,
 *     onProgress: (status, tasksComplete) => {
 *       console.log(`Status: ${status}, Tasks: ${tasksComplete}`);
 *     }
 *   });
 *   console.log('Success:', result.success);
 *   console.log('Output:', result.output);
 *
 * Work with Form Conditions:
 *   const form = await rewst.debugForm('form-id');
 *   const formValues = { brightness: true, color: false };
 *   const visibleFields = rewst.getVisibleFields(form, formValues);
 *   console.log('Visible fields:', visibleFields.map(f => f.schema.name));
 */
const REWST_DEFAULTS = {
  BASE_URL: 'https://app.rewst.io',
  GRAPHQL_PATH: '/graphql',
  SKIP_CONTEXT_WORKFLOWS: ['AI Internal Ticket Analysis'] // Workflow name patterns to skip context fetch
};
class RewstApp {
  constructor(config = {}) {
    this.graphqlUrl = config.graphqlPath || REWST_DEFAULTS.GRAPHQL_PATH;
    this._appUrl = config.appUrl || REWST_DEFAULTS.APP_URL;
    this._skipContextWorkflows = config.skipContextWorkflows || REWST_DEFAULTS.SKIP_CONTEXT_WORKFLOWS;

    this.orgId = null;
    this.isInitialized = false;
    this.debugMode = config.debug || window.DEBUG_MODE || false;

    // Cache for efficient lookups
    this._triggerCache = null;
    this._formCache = null;
    this._baseUrl = null;
  }

  /**
   * Enable or disable debug logging
   * @param {boolean} enabled - true to enable debug logs, false to disable
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
  }

  _log(...args) {
    if (this.debugMode) {
      console.log('[Rewst Debug]', ...args);
    }
  }

  _error(message, error) {
    console.error(`[Rewst Error] ${message}`);
    if (error) {
      console.error('Details:', error);
      if (error.stack) {
        console.error('Stack:', error.stack);
      }
    }
  }

  /**
   * Initialize the library and detect current organization
   * Must be called before using any other methods
   * @returns {Promise<string>} Organization ID
   */
  async init() {
    if (this.isInitialized) {
      this._log('Already initialized, returning existing org ID');
      return this.orgId;
    }

    try {
      this._log('Initializing Rewst library...');
      const org = await this._getCurrentOrganization();

      if (!org || !org.id) {
        throw new Error('Could not get organization from Rewst. Are you running inside a Rewst app?');
      }

      this.orgId = org.id;
      this.isInitialized = true;

      this._log('[SUCCESS] Successfully initialized for organization:', this.orgId);
      return this.orgId;

    } catch (error) {
      this._error('Failed to initialize Rewst library', error);
      throw new Error(
        `Initialization failed: ${error.message}. ` +
        `Make sure you are running this code inside a Rewst app page.`
      );
    }
  }

  /**
   * Get the current organization ID
   * @returns {string|null} Organization ID or null if not initialized
   */
  getOrgId() {
    if (!this.isInitialized) {
      console.warn('[Rewst Warning] getOrgId() called before init(). Call rewst.init() first.');
    }
    return this.orgId;
  }

  /**
   * Manually set organization ID (use this if init() fails)
   * @param {string} orgId - Organization ID to set
   */
  setOrgId(orgId) {
    this.orgId = orgId;
    this.isInitialized = true;
    this._log('Organization ID manually set to:', orgId);
  }

  /**
   * Run a workflow with automatic trigger detection (recommended method)
   * Tries simple execution first, then falls back to trigger-based execution
   * Returns output variables and trigger info when complete
   * @param {string} workflowId - The workflow ID to execute
   * @param {object} inputData - Input data for the workflow (default: {})
   * @param {object} options - Options object with optional onProgress callback
   * @returns {Promise<object>} Result with output, triggerInfo, execution details
   */
  async runWorkflowSmart(workflowId, inputData = {}, options = {}) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('runWorkflowSmart called before initialization', error);
      throw error;
    }

    this._log('Running workflow (smart mode):', workflowId);
    this._log('Input data:', inputData);

    try {
      this._log('Attempting simple testWorkflow execution...');
      return await this.runWorkflow(workflowId, inputData, options);

    } catch (firstError) {
      this._log('testWorkflow failed:', firstError.message);
      this._log('Attempting trigger-based execution...');

      try {
        const triggers = await this.getWorkflowTriggers(workflowId);

        if (!triggers || triggers.length === 0) {
          throw new Error(
            `Workflow execution failed. The workflow has no triggers configured and ` +
            `testWorkflow failed with error: ${firstError.message}`
          );
        }

        this._log(`Found ${triggers.length} trigger(s) for workflow`);

        let selectedTrigger = null;
        let selectedInstance = null;

        for (const trigger of triggers) {
          if (!trigger.enabled) {
            this._log(`Skipping disabled trigger: ${trigger.name}`);
            continue;
          }

          const instance = trigger.orgInstances?.find(inst => inst.orgId === this.orgId);
          if (instance) {
            selectedTrigger = trigger;
            selectedInstance = instance;
            this._log(`Using trigger: ${trigger.name} (${trigger.id})`);
            this._log(`Using instance: ${instance.id}`);
            break;
          }
        }

        if (!selectedTrigger || !selectedInstance) {
          throw new Error(
            `No active trigger instance found for organization ${this.orgId}. ` +
            `Available triggers: ${triggers.map(t => t.name).join(', ')}`
          );
        }

        return await this.runWorkflowWithTrigger(
          selectedInstance.id,
          selectedTrigger.id,
          inputData,
          options
        );

      } catch (secondError) {
        this._error('Both execution methods failed', secondError);
        throw new Error(
          `Failed to run workflow: ${secondError.message}. ` +
          `Try using debugWorkflow('${workflowId}') to see workflow details.`
        );
      }
    }
  }

  /**
   * Run a workflow using simple test execution (no trigger)
   * Use runWorkflowSmart() if you're not sure which method to use
   * @param {string} workflowId - The workflow ID to execute
   * @param {object} inputData - Input data for the workflow (default: {})
   * @param {object} options - Options object with optional onProgress callback
   * @returns {Promise<object>} Result with output, triggerInfo, execution details
   */
  async runWorkflow(workflowId, inputData = {}, options = {}) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('runWorkflow called before initialization', error);
      throw error;
    }

    const { onProgress } = options;

    this._log('Executing workflow (simple mode):', workflowId);
    this._log('Input data:', inputData);

    try {
      const execution = await this._executeSimple(workflowId, inputData);
      const executionId = execution.executionId;

      if (!executionId) {
        throw new Error('No execution ID returned from workflow execution');
      }

      this._log('Execution started successfully. ID:', executionId);

      if (onProgress) {
        try {
          onProgress('running', 0);
        } catch (progressError) {
          console.warn('[Rewst Warning] onProgress callback failed:', progressError.message);
          console.warn('Continuing workflow execution without progress updates...');
        }
      }

      const result = await this._waitForCompletion(executionId, onProgress);
      this._log('Workflow completed successfully');
      if ((result.type || '').toLowerCase() === 'form submission') {
    result.submittedInputs = this._extractSubmittedInputs(layer);
  }
  return result;

    } catch (error) {
      this._error(`Failed to execute workflow ${workflowId}`, error);
      throw new Error(
        `Workflow execution failed: ${error.message}. ` +
        `This may be because the workflow requires a trigger. Try using runWorkflowSmart() instead.`
      );
    }
  }

  /**
   * Run a workflow using a specific trigger instance
   * Use debugWorkflow() to find trigger IDs
   * @param {string} triggerInstanceId - The trigger instance ID
   * @param {string} triggerId - The trigger ID
   * @param {object} inputData - Input data for the workflow (default: {})
   * @param {object} options - Options object with optional onProgress callback
   * @returns {Promise<object>} Result with output, triggerInfo, execution details
   */
  async runWorkflowWithTrigger(triggerInstanceId, triggerId, inputData = {}, options = {}) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('runWorkflowWithTrigger called before initialization', error);
      throw error;
    }

    if (!triggerInstanceId || !triggerId) {
      const error = new Error('Both triggerInstanceId and triggerId are required');
      this._error('Invalid trigger IDs provided', error);
      throw error;
    }

    const { onProgress } = options;

    this._log('Executing workflow with trigger');
    this._log('Trigger ID:', triggerId);
    this._log('Trigger Instance ID:', triggerInstanceId);
    this._log('Input data:', inputData);

    try {
      const execution = await this._executeWithTrigger(triggerInstanceId, triggerId, inputData);
      const executionId = execution.executionId;

      if (!executionId) {
        throw new Error('No execution ID returned from workflow execution');
      }

      this._log('Execution started successfully. ID:', executionId);

      if (onProgress) {
        try {
          onProgress('running', 0);
        } catch (progressError) {
          console.warn('[Rewst Warning] onProgress callback failed:', progressError.message);
          console.warn('Continuing workflow execution without progress updates...');
        }
      }

      const result = await this._waitForCompletion(executionId, onProgress);
      this._log('Workflow completed successfully');
      if ((result.type || '').toLowerCase() === 'form submission') {
    result.submittedInputs = this._extractSubmittedInputs(layer);
  }
  return result;

    } catch (error) {
      this._error('Failed to execute workflow with trigger', error);
      throw new Error(
        `Workflow execution failed: ${error.message}. ` +
        `Check that trigger IDs are correct using debugWorkflow().`
      );
    }
  }

  /**
   * Debug a workflow - shows input/output schemas and trigger information
   * Prints detailed information to console and returns data object
   * @param {string} workflowId - The workflow ID to debug
   * @returns {Promise<object>} Object with workflowId, inputSchema, outputSchema, triggers
   */
  async debugWorkflow(workflowId) {
    console.log('\n[DEBUG] Workflow', workflowId);
    console.log('=====================================');

    try {
      this._log('Fetching workflow I/O configuration...');
      const ioConfig = await this.getWorkflowSchema(workflowId);

      console.log('\n[INPUT SCHEMA]');
      if (ioConfig?.input) {
        console.log(JSON.stringify(ioConfig.input, null, 2));
      } else {
        console.log('  No input schema defined (workflow may accept any inputs)');
      }

      console.log('\n[OUTPUT SCHEMA]');
      if (ioConfig?.output) {
        console.log(JSON.stringify(ioConfig.output, null, 2));
      } else {
        console.log('  No output schema defined');
      }

      this._log('Fetching workflow triggers...');
      const triggers = await this.getWorkflowTriggers(workflowId);

      console.log('\n[TRIGGERS]', triggers.length);

      if (triggers.length === 0) {
        console.log('  No triggers configured. Use runWorkflow() to execute this workflow.');
      } else {
        triggers.forEach((trigger, i) => {
          console.log(`\nTrigger ${i + 1}:`);
          console.log('  ID:', trigger.id);
          console.log('  Name:', trigger.name);
          console.log('  Enabled:', trigger.enabled);
          console.log('  Type:', trigger.triggerType?.name || 'Unknown');

          if (trigger.description) {
            console.log('  Description:', trigger.description);
          }

          const instanceCount = trigger.orgInstances?.length || 0;
          console.log('  Org Instances:', instanceCount);

          if (trigger.orgInstances && trigger.orgInstances.length > 0) {
            trigger.orgInstances.forEach((inst, j) => {
              const isCurrent = inst.orgId === this.orgId;
              const marker = isCurrent ? '<- YOUR ORG' : '';
              console.log(`    Instance ${j + 1}: ${inst.id} (Org: ${inst.organization?.name}) ${marker}`);
            });
          }
        });

        console.log('\n[TIP] Use runWorkflowSmart() to automatically handle triggers.');
      }

      console.log('\n=====================================\n');

      return {
        workflowId,
        inputSchema: ioConfig?.input,
        outputSchema: ioConfig?.output,
        triggers
      };

    } catch (error) {
      this._error('Failed to debug workflow', error);
      console.log('\n[ERROR] Debug failed. Error details above.');
      console.log('=====================================\n');
      throw new Error(`Failed to debug workflow: ${error.message}`);
    }
  }

  /**
   * Debug a form - shows field schemas, conditions, and trigger information
   * Prints detailed information to console and returns data object
   * @param {string} formId - The form ID to debug
   * @returns {Promise<object>} Object with formId, name, description, fields (sorted by index), triggers
   */
  async debugForm(formId) {
    console.log('\n[DEBUG] Form', formId);
    console.log('=====================================');

    try {
      this._log('Fetching form details...');
      const form = await this._getForm(formId);

      if (!form) {
        throw new Error(`Form ${formId} not found`);
      }

      console.log('\n[FORM NAME]', form.name || 'Unnamed Form');

      if (form.description) {
        console.log('Description:', form.description);
      }

      // Sort fields by index
      if (form.fields && form.fields.length > 0) {
        form.fields.sort((a, b) => (a.index || 0) - (b.index || 0));
      }

      const fieldCount = form.fields?.length || 0;
      console.log('\n[FIELDS]', fieldCount);

      if (form.fields && form.fields.length > 0) {
        form.fields.forEach((field, i) => {
          console.log(`\nField ${i + 1}:`);
          console.log('  ID:', field.id);
          console.log('  Type:', field.type);
          console.log('  Index:', field.index);

          if (field.schema) {
            console.log('  Schema:', JSON.stringify(field.schema, null, 2));
          }

          if (field.conditions && field.conditions.length > 0) {
            console.log('  Conditions:', field.conditions.length);
            field.conditions.forEach((cond, j) => {
              console.log(`    ${j + 1}. ${cond.action.toUpperCase()} when "${cond.sourceField?.schema?.name}" = ${JSON.stringify(cond.requiredValue)}`);
            });
          }
        });

        console.log('\n[TIP] When submitting this form, provide values matching the field schemas above.');
        console.log('[TIP] Use evaluateFieldConditions(field, formValues) to check visibility based on values.');
      } else {
        console.log('  No fields defined in this form.');
      }

      console.log('\n[TRIGGERS]');
      if (form.triggers && form.triggers.length > 0) {
        form.triggers.forEach(trigger => {
          console.log('  - Name:', trigger.name);
          console.log('    ID:', trigger.id);
        });
        console.log('\n[TIP] Use these trigger IDs when calling submitForm().');
      } else {
        console.log('  No triggers configured for this form.');
      }

      console.log('\n=====================================\n');

      return {
        formId,
        name: form.name,
        description: form.description,
        fields: form.fields,
        triggers: form.triggers
      };

    } catch (error) {
      this._error('Failed to debug form', error);
      console.log('\n[ERROR] Debug failed. Error details above.');
      console.log('=====================================\n');
      throw new Error(`Failed to debug form: ${error.message}`);
    }
  }

  /**
   * Evaluate whether a field should be shown based on its conditions
   * @param {object} field - The form field object with conditions
   * @param {object} formValues - Current form values (e.g., { brightness: true, color: false })
   * @returns {object} Result with { visible, required, setValue, conditions }
   */
  evaluateFieldConditions(field, formValues = {}) {
    if (!field.conditions || field.conditions.length === 0) {
      return {
        visible: true,
        required: field.schema?.required || false,
        setValue: null,
        conditions: []
      };
    }

    let visible = true;
    let required = field.schema?.required || false;
    let setValue = null;
    const appliedConditions = [];

    for (const condition of field.conditions) {
      const sourceFieldName = condition.sourceField?.schema?.name;
      if (!sourceFieldName) continue;

      const sourceValue = formValues[sourceFieldName];
      const conditionMet = sourceValue === condition.requiredValue;

      if (conditionMet) {
        appliedConditions.push({
          action: condition.action,
          sourceField: sourceFieldName,
          requiredValue: condition.requiredValue
        });

        switch (condition.action) {
          case 'show':
            visible = true;
            break;
          case 'hide':
            visible = false;
            break;
          case 'required':
            required = true;
            break;
          case 'set':
            setValue = condition.actionValue;
            break;
        }
      } else {
        // If condition NOT met and action was 'show', field should be hidden
        if (condition.action === 'show') {
          visible = false;
        }
        // If condition NOT met and action was 'hide', field should be shown
        if (condition.action === 'hide') {
          visible = true;
        }
      }
    }

    return { visible, required, setValue, conditions: appliedConditions };
  }

  /**
   * Get all visible fields for a form based on current values
   * @param {object} form - Form object from getAllForms() or debugForm()
   * @param {object} formValues - Current form values
   * @returns {Array} Array of visible fields with evaluation results
   */
  getVisibleFields(form, formValues = {}) {
    if (!form.fields) return [];

    return form.fields.map(field => {
      const evaluation = this.evaluateFieldConditions(field, formValues);
      return {
        ...field,
        evaluation
      };
    }).filter(field => field.evaluation.visible);
  }

  /**
   * Get all triggers configured for a workflow
   * @param {string} workflowId - The workflow ID
   * @returns {Promise<Array>} Array of trigger objects with details
   */
  async getWorkflowTriggers(workflowId) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getWorkflowTriggers called before initialization', error);
      throw error;
    }

    this._log('Fetching triggers for workflow:', workflowId);

    try {
      const query = `
        query getWorkflowTriggers($id: ID!, $orgId: ID!) {
          triggers(where: {workflowId: $id, orgId: $orgId}) {
            id
            name
            description
            enabled
            parameters
            formId
            autoActivateManagedOrgs
            activatedForOrgs {
              id
              name
            }
            orgInstances {
              id
              orgId
              isManualActivation
              organization {
                id
                name
              }
            }
            triggerType {
              id
              name
              webhookUrlTemplate
              canRunForManagedOrgs
            }
          }
        }
      `;

      const result = await this._graphql('getWorkflowTriggers', query, {
        id: workflowId,
        orgId: this.orgId
      });

      this._log(`Found ${result.triggers?.length || 0} trigger(s)`);
      return result.triggers || [];

    } catch (error) {
      this._error(`Failed to get triggers for workflow ${workflowId}`, error);
      throw new Error(
        `Failed to get workflow triggers: ${error.message}. ` +
        `Check that the workflow ID is correct.`
      );
    }
  }

  /**
   * Submit a form with values and optionally wait for workflow completion
   * Use debugForm() to find trigger IDs
   * @param {string} formId - The form ID to submit
   * @param {object} formValues - Object with form field values
   * @param {string} triggerId - The trigger ID to use for submission
   * @param {object} options - Options object with optional waitForCompletion and onProgress
   * @returns {Promise<object>} Submission result with optional execution details
   */
  async submitForm(formId, formValues, triggerId, options = {}) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('submitForm called before initialization', error);
      throw error;
    }

    if (!formId || !triggerId) {
      const error = new Error('Both formId and triggerId are required');
      this._error('Invalid form submission parameters', error);
      throw error;
    }

    const { waitForCompletion = false, onProgress } = options;

    this._log('Submitting form:', formId);
    this._log('With values:', formValues);
    this._log('Trigger ID:', triggerId);
    this._log('Wait for completion:', waitForCompletion);

    try {
      // Get trigger details to find the workflow ID
      const triggerInfo = await this._getTriggerInfo(triggerId);

      if (!triggerInfo || !triggerInfo.workflowId) {
        throw new Error('Could not determine workflow ID from trigger');
      }

      const workflowId = triggerInfo.workflowId;
      this._log('Form submission will trigger workflow:', workflowId);

      // Submit the form
      const query = `
        mutation submitFormWithFiles($id: ID!, $values: JSON!, $triggerId: ID!, $orgId: ID!) {
          submitForm(id: $id, values: $values, triggerId: $triggerId, orgId: $orgId)
        }
      `;

      const submitResult = await this._graphql('submitFormWithFiles', query, {
        id: formId,
        values: formValues,
        triggerId,
        orgId: this.orgId
      });

      this._log('Form submitted successfully');

      if (onProgress) {
        try {
          onProgress('submitted', null);
        } catch (progressError) {
          console.warn('[Rewst Warning] onProgress callback failed:', progressError.message);
        }
      }

      const result = {
        submitted: true,
        submitResult: submitResult.submitForm,
        workflowId: workflowId
      };

      // If we should wait for completion, find and track the execution
      if (waitForCompletion) {
        this._log('Waiting for workflow execution to start...');

        if (onProgress) {
          try {
            onProgress('finding_execution', null);
          } catch (progressError) {
            console.warn('[Rewst Warning] onProgress callback failed:', progressError.message);
          }
        }

        // Wait a moment for the execution to be created
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find the execution that was just created
        const executionId = await this._findRecentExecution(workflowId, triggerId);

        if (!executionId) {
          this._log('Could not find execution ID, returning submission result only');
          if ((result.type || '').toLowerCase() === 'form submission') {
    result.submittedInputs = this._extractSubmittedInputs(layer);
  }
  return result;
        }

        this._log('Found execution ID:', executionId);
        result.executionId = executionId;

        if (onProgress) {
          try {
            onProgress('running', 0);
          } catch (progressError) {
            console.warn('[Rewst Warning] onProgress callback failed:', progressError.message);
          }
        }

        // Wait for the execution to complete
        const executionResult = await this._waitForCompletion(executionId, onProgress);

        result.execution = executionResult;
        result.output = executionResult.output;
        result.success = executionResult.success;

        this._log('Workflow execution completed');
      }

      if ((result.type || '').toLowerCase() === 'form submission') {
    result.submittedInputs = this._extractSubmittedInputs(layer);
  }
  return result;

    } catch (error) {
      this._error('Failed to submit form', error);
      throw new Error(
        `Form submission failed: ${error.message}. ` +
        `Use debugForm('${formId}') to verify form fields and trigger IDs.`
      );
    }
  }

  /**
   * Get the most recent execution result for a workflow (optimized - no chunking)
   * Returns the same format as runWorkflowSmart() for easy drop-in replacement
   * @param {string} workflowId - The workflow ID to get last execution for
   * @returns {Promise<object>} Result with output, triggerInfo, execution details (same format as runWorkflowSmart)
   */
    async getLastWorkflowExecution(workflowId) {
      if (!this.isInitialized) {
        const error = new Error('Rewst not initialized. Call rewst.init() first!');
        this._error('getLastWorkflowExecution called before initialization', error);
        throw error;
      }

      this._log('Fetching last execution for workflow:', workflowId);

      try {
        // Directly query for just the most recent execution (limit 1) - no chunking needed
        const query = `
          query getLastWorkflowExecution($where: WorkflowExecutionWhereInput!, $order: [[String!]!]!, $limit: Int) {
            workflowExecutions(
              where: $where
              order: $order
              limit: $limit
            ) {
              id
              status
              createdAt
              updatedAt
              numSuccessfulTasks
              workflow {
                id
                orgId
                name
                type
                humanSecondsSaved
              }
            }
          }
        `;

        const result = await this._graphql('getLastWorkflowExecution', query, {
          where: { 
            orgId: this.orgId,
            workflowId: workflowId 
          },
          order: [["createdAt", "desc"]],
          limit: 1
        });

        const executions = result.workflowExecutions || [];

        if (executions.length === 0) {
          throw new Error(`No executions found for workflow ${workflowId}`);
        }

        const lastExecution = executions[0];
        this._log('Found last execution:', lastExecution.id);

        // Get full details including output and trigger info
        const fullResult = await this.getExecutionStatus(lastExecution.id, true, true);

        // Return in the same format as runWorkflowSmart()
        return {
          ...fullResult,
          success: true
        };

      } catch (error) {
        this._error(`Failed to get last execution for workflow ${workflowId}`, error);
        throw new Error(`Failed to get last workflow execution: ${error.message}`);
      }
    }

  /**
   * Get all organization variables visible to current org
   * @param {number} limit - Maximum number of variables to return (default: 100)
   * @returns {Promise<Array>} Array of org variable objects with id, name, value, category, cascade
   */
  async getOrgVariables(limit = 100) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getOrgVariables called before initialization', error);
      throw error;
    }

    this._log('Fetching org variables (limit:', limit + ')');

    try {
      const query = `
        query getVisibleOrgVariables($visibleForOrgId: ID!, $limit: Int) {
          visibleOrgVariables(visibleForOrgId: $visibleForOrgId, limit: $limit) {
            id
            name
            value
            category
            cascade
          }
        }
      `;

      const result = await this._graphql('getVisibleOrgVariables', query, {
        visibleForOrgId: this.orgId,
        limit
      });

      this._log(`Retrieved ${result.visibleOrgVariables?.length || 0} variable(s)`);
      return result.visibleOrgVariables || [];

    } catch (error) {
      this._error('Failed to get org variables', error);
      throw new Error(`Failed to get organization variables: ${error.message}`);
    }
  }


  /**
   * Get all organization variables with organization info (enhanced version)
   * Returns variables visible to current org with the owning organization's id and name
   * @param {number} limit - Maximum number of variables to return (default: 500)
   * @returns {Promise<Array>} Array of org variable objects with id, name, value, category, cascade, organization { id, name }
   */
  async getOrgVariablesWithOrg(limit = 500, targetOrgId = null) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getOrgVariablesWithOrg called before initialization', error);
      throw error;
    }

    // Use provided org ID or fall back to logged-in org
    const orgIdToUse = targetOrgId || this.orgId;
    this._log('Fetching org variables with org info (limit:', limit + ', orgId:', orgIdToUse + ')');

    try {
      const query = `
        query getVisibleOrgVariables($visibleForOrgId: ID!, $limit: Int) {
          visibleOrgVariables(visibleForOrgId: $visibleForOrgId, limit: $limit) {
            id
            name
            value
            category
            cascade
            organization {
              id
              name
            }
          }
        }
      `;

      const result = await this._graphql('getVisibleOrgVariables', query, {
        visibleForOrgId: orgIdToUse,
        limit
      });

      this._log(`Retrieved ${result.visibleOrgVariables?.length || 0} variable(s) with org info for org ${orgIdToUse}`);
      return result.visibleOrgVariables || [];

    } catch (error) {
      this._error('Failed to get org variables with org info', error);
      // Preserve session expired flag when re-throwing
      const wrappedError = new Error(`Failed to get organization variables: ${error.message}`);
      if (error.isSessionExpired) {
        wrappedError.isSessionExpired = true;
        wrappedError.loginUrl = error.loginUrl;
      }
      throw wrappedError;
    }
  }

  /**
   * Get installed integrations (packs and bundles) for the current org
   * Returns array of installed pack objects with slug, name, id, etc.
   * @param {boolean} includeCustomPack - Include custom packs (default: true)
   * @returns {Promise<Array>} Array of installed pack objects with slug, name, id, isBundle, packType
   */
  async getInstalledIntegrations(includeCustomPack = true) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getInstalledIntegrations called before initialization', error);
      throw error;
    }

    this._log('Fetching installed integrations...');

    try {
      const query = `
        query getPacksAndBundlesByInstalledState($orgId: ID!, $includeCustomPack: Boolean) {
          packsAndBundlesByInstalledState(orgId: $orgId, includeCustomPack: $includeCustomPack) {
            installedPacksAndBundles {
              id
              name
              ref
              isBundle
              packType
              includedPacks {
                id
                name
                ref
              }
            }
          }
        }
      `;

      const result = await this._graphql('getPacksAndBundlesByInstalledState', query, {
        orgId: this.orgId,
        includeCustomPack
      });

      // Normalize the response - 'ref' is the slug
      // Filter out 'core' pack which is always installed and not a real integration
      const installedPacks = (result?.packsAndBundlesByInstalledState?.installedPacksAndBundles || [])
        .filter(pack => pack.ref !== 'core')
        .map(pack => ({
          slug: pack.ref,
          name: pack.name,
          id: pack.id,
          isBundle: pack.isBundle,
          packType: pack.packType,
          includedPacks: pack.includedPacks || []
        }));

      this._log(`Found ${installedPacks.length} installed integration(s) (excluding Core)`);
      return installedPacks;

    } catch (error) {
      this._error('Failed to get installed integrations', error);
      // Return empty array on error so page still renders
      return [];
    }
  }

  /**
   * Get integration configurations with authorization status
   * Returns installed integrations with their config and whether they're authorized
   * @param {boolean} includeCustomPack - Include custom packs (default: true)
   * @returns {Promise<Array>} Array of integration objects with name, slug, isConfigured, config
   */
  async getIntegrationConfigs(includeCustomPack = true) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getIntegrationConfigs called before initialization', error);
      throw error;
    }

    this._log('Fetching integration configurations...');

    try {
      // First get installed integrations
      const installedPacks = await this.getInstalledIntegrations(includeCustomPack);

      if (installedPacks.length === 0) {
        this._log('No installed integrations found');
        return [];
      }

      // Collect all pack IDs including included packs from bundles
      const packIds = installedPacks.map(p => p.id);
      const bundlePackIds = installedPacks
        .filter(p => p.isBundle && p.includedPacks?.length > 0)
        .flatMap(p => p.includedPacks.map(ip => ip.id));
      const allPackIds = [...new Set([...packIds, ...bundlePackIds])];

      const configQuery = `
        query getPackConfigs($packIds: [ID!]!, $orgId: ID!) {
          packConfigsForOrg(packIds: $packIds, orgId: $orgId) {
            id
            name
            packId
            config
            metadata
            default
            pack { id name ref }
          }
        }
      `;

      const configResult = await this._graphql('getPackConfigs', configQuery, {
        packIds: allPackIds,
        orgId: this.orgId
      });

      const configs = configResult?.packConfigsForOrg || [];

      // Helper to check if a config indicates authorization
      const isConfigured = (cfg) => {
        if (!cfg?.config) return false;
        const c = cfg.config;

        // Check for any non-empty secret/credential field
        const secretFields = [
          'api_key', 'api_password', 'password', 'private_key',
          'client_secret', 'oauth_client_secret', 'basic_auth_password'
        ];

        for (const field of secretFields) {
          if (c[field] && c[field] !== '') return true;
        }

        // OAuth tokens (stored or refresh)
        if (c.oauth?.access_token || c.oauth?.refresh_token) return true;

        return false;
      };

      // Map installed packs to their configs and auth status
      const integrations = installedPacks.map(pack => {
        const packConfig = configs.find(c => c.packId === pack.id);

        // For bundles, check if any included pack is configured
        let bundleConfigured = false;
        let includedPackConfigs = [];
        if (pack.isBundle && pack.includedPacks?.length > 0) {
          includedPackConfigs = pack.includedPacks.map(ip => {
            const ipConfig = configs.find(c => c.packId === ip.id);
            return {
              id: ip.id,
              name: ip.name,
              slug: ip.ref,
              hasConfig: !!ipConfig,
              isConfigured: isConfigured(ipConfig)
            };
          });
          bundleConfigured = includedPackConfigs.some(ipc => ipc.isConfigured);
        }

        return {
          id: pack.id,
          name: pack.name,
          slug: pack.slug,
          isBundle: pack.isBundle,
          packType: pack.packType,
          hasConfig: !!packConfig,
          isConfigured: isConfigured(packConfig) || bundleConfigured,
          config: packConfig?.config || null,
          configId: packConfig?.id || null,
          includedPacks: pack.isBundle ? includedPackConfigs : undefined
        };
      });

      this._log(`Retrieved configs for ${integrations.length} integration(s), ${integrations.filter(i => i.isConfigured).length} configured`);
      return integrations;

    } catch (error) {
      this._error('Failed to get integration configs', error);
      // Re-throw session expired errors so UI can show login overlay
      if (error.isSessionExpired) {
        const wrappedError = new Error(`Failed to get integration configs: ${error.message}`);
        wrappedError.isSessionExpired = true;
        wrappedError.loginUrl = error.loginUrl;
        throw wrappedError;
      }
      return [];
    }
  }

  /**
   * Get all organizations managed by a parent organization (including the parent itself)
   * Useful for MSP scenarios where parent org manages multiple child orgs
   * Returns the specified org plus any child orgs it manages
   * @param {string} [parentOrgId] - Optional parent org ID. If not provided, uses the logged-in org.
   * @returns {Promise<Array>} Array of organization objects with id, name, domain, etc.
   */
  async getManagedOrganizations(parentOrgId = null) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getManagedOrganizations called before initialization', error);
      throw error;
    }

    const targetOrgId = parentOrgId || this.orgId;
    this._log(`Fetching managed organizations for org: ${targetOrgId}...`);

    try {
      const query = `
        query getManagedOrgs($managingOrgId: ID!) {
          organizations(where: { managingOrgId: $managingOrgId }) {
            id
            name
            domain
            isEnabled
            rocSiteId
            managingOrgId
          }
        }
      `;

      const result = await this._graphql('getManagedOrgs', query, {
        managingOrgId: targetOrgId
      });

      const managedOrgs = result.organizations || [];

      // Fetch the target org details to include it
      let targetOrg = null;

      if (parentOrgId && parentOrgId !== this.orgId) {
        // Fetch specific org by ID using organizations(where:) syntax
        const specificOrgQuery = `
          query getOrg($orgId: ID!) {
            organizations(where: { id: $orgId }) {
              id
              name
              domain
              isEnabled
              rocSiteId
              managingOrgId
            }
          }
        `;
        const specificOrgResult = await this._graphql('getOrg', specificOrgQuery, { orgId: parentOrgId });
        targetOrg = specificOrgResult.organizations?.[0] || null;
      } else {
        // Fetch the logged-in user's org
        const currentOrgQuery = `
          query getCurrentOrg {
            userOrganization {
              id
              name
              domain
              isEnabled
              rocSiteId
              managingOrgId
            }
          }
        `;
        const currentOrgResult = await this._graphql('getCurrentOrg', currentOrgQuery);
        targetOrg = currentOrgResult.userOrganization;
      }

      // Combine target org with managed orgs (target org first)
      const allOrgs = targetOrg ? [targetOrg, ...managedOrgs] : managedOrgs;

      // SAFETY: Filter out "Rewst Staff" org - should never be selectable or run against
      const BLOCKED_ORG_NAMES = ['rewst staff'];
      const safeOrgs = allOrgs.filter(org => {
        const orgName = (org.name || '').toLowerCase().trim();
        return !BLOCKED_ORG_NAMES.includes(orgName);
      });

      this._log(`Retrieved ${safeOrgs.length} total organization(s) (filtered from ${allOrgs.length}, 1 target + ${managedOrgs.length} managed)`);
      return safeOrgs;

    } catch (error) {
      this._error('Failed to get managed organizations', error);
      // Preserve session expired flag when re-throwing
      const wrappedError = new Error(`Failed to get managed organizations: ${error.message}`);
      if (error.isSessionExpired) {
        wrappedError.isSessionExpired = true;
        wrappedError.loginUrl = error.loginUrl;
      }
      throw wrappedError;
    }
  }

  /**
   * Get a specific organization variable by name
   * @param {string} name - Variable name to look up
   * @returns {Promise<any>} Variable value, or null if not found
   */
  async getOrgVariable(name) {
    if (!name) {
      const error = new Error('Variable name is required');
      this._error('getOrgVariable called without name', error);
      throw error;
    }

    this._log('Fetching org variable:', name);

    try {
      const variables = await this.getOrgVariables();
      const variable = variables.find(v => v.name === name);

      if (variable) {
        this._log(`Found variable "${name}" with value:`, variable.value);
        return variable.value;
      } else {
        this._log(`Variable "${name}" not found`);
        return null;
      }

    } catch (error) {
      this._error(`Failed to get org variable "${name}"`, error);
      throw new Error(`Failed to get organization variable: ${error.message}`);
    }
  }

  /**
   * Get workflow executions with optional filtering
   * @param {boolean} includeTriggerInfo - Include trigger type info for each execution (default: true)
   * @param {number|null} daysBack - Number of days to look back, or null for all time (default: null)
   * @param {string|null} workflowId - Optional workflow ID to filter by (default: null for all workflows)
   * @param {boolean} includeRawContext - Include raw context data in triggerInfo (default: false)
   * @param {Array<string>|null} orgIds - Optional array of org IDs to fetch executions for (default: null for current org only)
   * @returns {Promise<Array>} Array of execution objects with status, workflow (including humanSecondsSaved), and optional triggerInfo
   */
  // Adaptive chunk sizes for execution fetching (from largest to smallest)
  static CHUNK_SIZES = [6, 3, 2, 1, 0.5, 0.25, 0.1];
  // Max orgs per query - large IN clauses are slow, so batch and run in parallel
  // Reduced to 5 to avoid Rewst server-side query timeouts
  static ORG_BATCH_SIZE = 5;
  static ORG_SLIDING_THRESHOLD = 10;  // Use sliding window if ≤10 orgs
  static ORG_WINDOW_SIZE = 3;         // Process 3 orgs at a time (staggered parallel)
  static MAX_SLIDING_WINDOW_MS = 60000; // Max time for sliding window phase (60s) - then render with what we have

  // Workflow scope filter: 'parents' | 'subs' | 'both'
  static WORKFLOW_SCOPE = 'parents';  // Default: parents only (fast load)

  // Backwards compatibility with INCLUDE_SUB_WORKFLOWS (legacy boolean flag)
  static get INCLUDE_SUB_WORKFLOWS() {
    return this.WORKFLOW_SCOPE !== 'parents';
  }
  static set INCLUDE_SUB_WORKFLOWS(value) {
    if (typeof value === 'boolean') {
      this.WORKFLOW_SCOPE = value ? 'both' : 'parents';
    } else {
      this.WORKFLOW_SCOPE = value;
    }
  }

  static EXCLUDE_SUB_WORKFLOWS_FOR_ORGS = []; // Array of org IDs to exclude from sub-workflow fetch
  // Progressive TIMEOUTS - SHORTER for main fetch to respect 60s global deadline
  // Retry timeouts are longer since they run in background
  static CHUNK_TIMEOUTS = {
    6: 10000,    // 10 seconds for 6-day chunks (fail fast to hit deadline)
    3: 10000,    // 10 seconds for 3-day chunks
    2: 10000,    // 10 seconds for 2-day chunks
    1: 12000,    // 12 seconds for 1-day chunks
    0.5: 15000,  // 15 seconds for 0.5-day chunks (12 hours)
    0.25: 15000, // 15 seconds for 0.25-day chunks (6 hours)
    0.1: 15000   // 15 seconds for 0.1-day chunks (~2.4 hours)
  };
  // RETRY-SPECIFIC: Same chunk sizes as regular fetch so we don't abandon busy orgs too early
  // Goes down to 0.05d (1.2 hours) for very busy orgs - smaller than main fetch
  static RETRY_CHUNK_SIZES = [3, 2, 1, 0.5, 0.25, 0.1, 0.05];  // Start at 3 days, go down to 0.05d (1.2 hours)
  static RETRY_CHUNK_TIMEOUTS = {
    3: 20000,    // 20 seconds for 3-day chunks
    2: 20000,    // 20 seconds for 2-day chunks
    1: 25000,    // 25 seconds for 1-day chunks
    0.5: 30000,  // 30 seconds for 0.5-day chunks (12 hours)
    0.25: 35000, // 35 seconds for 0.25-day chunks (6 hours)
    0.1: 45000,  // 45 seconds for 0.1-day chunks (2.4 hours)
    0.05: 60000  // 60 seconds for 0.05-day chunks (1.2 hours) - last resort for very slow orgs
  };

  /**
   * Fetch executions for a date range with adaptive chunk sizing.
   * Starts with larger chunks and automatically splits on timeout.
   * Supports options.deadline - if set, will bail out mid-loop and throw DeadlineError with partial results.
   * @private
   */
  async _fetchChunkAdaptive(startDay, endDay, chunkSizeIndex, workflowId, orgIds, allResults = [], options = {}) {
    // Allow custom chunk sizes via options (for workflow-chunking with larger initial chunks)
    const CHUNK_SIZES = options.chunkSizes || RewstApp.CHUNK_SIZES;
    const CHUNK_TIMEOUTS = options.chunkTimeouts || RewstApp.CHUNK_TIMEOUTS;
    // Use globalDeadline (from getRecentExecutions) if provided, else fall back to per-chunk deadline
    const { globalDeadline, deadline, deadlineFailedOrgs } = options;
    const effectiveDeadline = globalDeadline || deadline;

    // Process from endDay backwards to startDay
    let currentEnd = endDay;
    let currentChunkIndex = chunkSizeIndex;

    while (currentEnd > startDay) {
      // Check global deadline at start of each chunk iteration
      if (effectiveDeadline && Date.now() > effectiveDeadline) {
        this._log(`⏰ GLOBAL DEADLINE HIT inside _fetchChunkAdaptive - returning ${allResults.length} partial results, remaining: days ${startDay}-${currentEnd}`);
        const deadlineError = new Error('DEADLINE_HIT');
        deadlineError.isDeadline = true;
        deadlineError.partialResults = allResults;
        deadlineError.remainingRange = { startDay, endDay: currentEnd, chunkSizeIndex: currentChunkIndex };
        throw deadlineError;
      }

      const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
      const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
      const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 10000;

      this._log(`Fetching days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (${currentChunkSize}-day chunk, ${timeoutMs/1000}s timeout)...`);

      try {
        const fetchStart = Date.now();
        // Pass globalDeadline and deadlineFailedOrgs through to sliding window
        const chunkExecutions = await this._fetchExecutionsChunk(currentStart, currentEnd, workflowId, orgIds, {
          timeout: timeoutMs,
          ...options,
          globalDeadline: effectiveDeadline,
          deadlineFailedOrgs
        });
        const elapsed = Date.now() - fetchStart;

        if (elapsed > timeoutMs && currentChunkIndex < CHUNK_SIZES.length - 1) {
          // Took too long but succeeded - split for remaining chunks
          this._log(`⚠️ Chunk took ${elapsed}ms (>${timeoutMs}ms), reducing chunk size for remaining days`);
          currentChunkIndex++;
        }

        allResults.push(...chunkExecutions);
        this._log(`✓ Got ${chunkExecutions.length} executions in ${elapsed}ms`);
        currentEnd = currentStart;

      } catch (error) {
        // Check if it's a timeout/abort error OR our explicit retry signal
        const isTimeout = error.name === 'AbortError' || error.message?.includes('timed out');
        const isRetrySignal = error.message?.includes('will retry with smaller');

        this._log(`🔍 Chunk error: "${error.message}" (timeout: ${isTimeout}, retrySignal: ${isRetrySignal})`);

        if (currentChunkIndex < CHUNK_SIZES.length - 1) {
          // Try smaller chunk size for this same range
          const smallerSize = CHUNK_SIZES[currentChunkIndex + 1];
          this._log(`⚠️ Chunk failed, retrying days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} with ${smallerSize}-day chunks (was ${currentChunkSize}-day)...`);
          currentChunkIndex++;
          // Don't advance currentEnd - retry the same range with smaller chunks
        } else {
          // At minimum chunk size and still failing - log and skip this range
          const dateStart = new Date(Date.now() - currentEnd * 24 * 60 * 60 * 1000).toLocaleDateString();
          const dateEnd = new Date(Date.now() - currentStart * 24 * 60 * 60 * 1000).toLocaleDateString();
          this._error(`Failed to fetch ${dateStart} - ${dateEnd} even at minimum chunk size (0.1 day). Skipping this range.`, error);
          currentEnd = currentStart; // Skip and move on
        }
      }

      // Small delay between chunks to be nice to the API
      if (currentEnd > startDay) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return allResults;
  }

  /**
   * SINGLE-ORG ONLY: Adaptive chunking for a single org (used by sliding window)
   * Calls _fetchExecutionsChunkSingle directly to avoid routing back to sliding window
   * @private
   */
  async _fetchChunkAdaptiveSingleOrg(startDay, endDay, chunkSizeIndex, workflowId, orgId, allResults = [], options = {}) {
    // Allow custom chunk sizes via options (for workflow-chunking with larger initial chunks)
    const CHUNK_SIZES = options.chunkSizes || RewstApp.CHUNK_SIZES;
    const CHUNK_TIMEOUTS = options.chunkTimeouts || RewstApp.CHUNK_TIMEOUTS;
    const { deadline } = options;

    let currentEnd = endDay;
    let currentChunkIndex = chunkSizeIndex;

    while (currentEnd > startDay) {
      // Check deadline at start of each chunk iteration
      if (deadline && Date.now() > deadline) {
        this._log(`⏰ DEADLINE HIT for org ${orgId.slice(0, 8)} - returning ${allResults.length} partial results, remaining: days ${startDay}-${currentEnd}`);
        const deadlineError = new Error('DEADLINE_HIT');
        deadlineError.isDeadline = true;
        deadlineError.partialResults = allResults;
        deadlineError.remainingRange = { startDay, endDay: currentEnd, chunkSizeIndex: currentChunkIndex };
        throw deadlineError;
      }

      const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
      const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
      const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 10000;

      this._log(`   📦 [${orgId.slice(0, 8)}] days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (${currentChunkSize}d chunk, ${timeoutMs/1000}s timeout)`);

      try {
        const fetchStart = Date.now();
        // Call single-org fetch directly (not _fetchExecutionsChunk which routes to sliding window)
        const chunkExecutions = await this._fetchExecutionsChunkSingle(currentStart, currentEnd, workflowId, [orgId], { timeout: timeoutMs, ...options });
        const elapsed = Date.now() - fetchStart;

        if (elapsed > timeoutMs && currentChunkIndex < CHUNK_SIZES.length - 1) {
          this._log(`   ⚠️ [${orgId.slice(0, 8)}] chunk took ${elapsed}ms, reducing size`);
          currentChunkIndex++;
        }

        allResults.push(...chunkExecutions);
        this._log(`   ✓ [${orgId.slice(0, 8)}] got ${chunkExecutions.length} in ${elapsed}ms (total: ${allResults.length})`);
        currentEnd = currentStart;

      } catch (error) {
        if (currentChunkIndex < CHUNK_SIZES.length - 1) {
          const smallerSize = CHUNK_SIZES[currentChunkIndex + 1];
          this._log(`   ⚠️ [${orgId.slice(0, 8)}] timeout, trying ${smallerSize}d chunk...`);
          currentChunkIndex++;
        } else {
          this._error(`Failed to fetch org ${orgId.slice(0, 8)} at minimum chunk size. Skipping remaining days.`, error);
          currentEnd = startDay; // Skip remaining
        }
      }

      if (currentEnd > startDay) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return allResults;
  }

  /**
   * RETRY-SPECIFIC: Fetch with adaptive chunk sizes down to 0.1 day (2.4 hours)
   * Used by background retry - starts smaller but goes all the way down to catch busy orgs
   * @private
   */
  async _fetchChunkAdaptiveRetry(startDay, endDay, chunkSizeIndex, workflowId, orgIds, allResults = [], options = {}) {
    const CHUNK_SIZES = RewstApp.RETRY_CHUNK_SIZES;  // [3, 2, 1, 0.5, 0.25, 0.1] - goes down to 0.1 day
    const CHUNK_TIMEOUTS = RewstApp.RETRY_CHUNK_TIMEOUTS;

    let currentEnd = endDay;
    let currentChunkIndex = chunkSizeIndex;

    while (currentEnd > startDay) {
      const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
      const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
      const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 25000;

      this._log(`   [RETRY] Fetching days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (${currentChunkSize}-day chunk, ${timeoutMs/1000}s timeout)...`);

      try {
        const fetchStart = Date.now();
        // IMPORTANT: Call _fetchExecutionsChunkSingle directly, NOT _fetchExecutionsChunk
        // _fetchExecutionsChunk routes to sliding window which has a 60s global deadline
        // Retry should run indefinitely without a deadline - it's the background task
        const chunkExecutions = await this._fetchExecutionsChunkSingle(currentStart, currentEnd, workflowId, orgIds, { timeout: timeoutMs, ...options });
        const elapsed = Date.now() - fetchStart;

        if (elapsed > timeoutMs && currentChunkIndex < CHUNK_SIZES.length - 1) {
          this._log(`   [RETRY] ⚠️ Chunk took ${elapsed}ms, reducing chunk size`);
          currentChunkIndex++;
        }

        allResults.push(...chunkExecutions);
        this._log(`   [RETRY] ✓ Got ${chunkExecutions.length} in ${elapsed}ms`);
        currentEnd = currentStart;

      } catch (error) {
        if (currentChunkIndex < CHUNK_SIZES.length - 1) {
          const smallerSize = CHUNK_SIZES[currentChunkIndex + 1];
          this._log(`   [RETRY] ⚠️ Failed, trying ${smallerSize}-day chunks...`);
          currentChunkIndex++;
        } else {
          // At 0.05-day (1.2 hour) minimum - skip this range and continue with the rest
          this._log(`   [RETRY] ⚠️ Skipping days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (failed at 0.05d minimum) - continuing with remaining time ranges`);
          // Track skipped range for debugging
          if (!this._skippedTimeRanges) this._skippedTimeRanges = [];
          this._skippedTimeRanges.push({ startDay: currentStart, endDay: currentEnd, orgIds });
          // Move to next chunk - STAY at smallest chunk size (don't reset to 0)
          currentEnd = currentStart;
          // Keep currentChunkIndex at the smallest size - if this org is busy, smaller chunks are needed
          continue;
        }
      }

      if (currentEnd > startDay) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return allResults;
  }

  /**
   * RETRY-SPECIFIC with LIGHTWEIGHT-FIRST optimization
   * Two-pass approach:
   *   1. Lightweight query first (no conductor.input) - much faster, more likely to succeed
   *   2. Only fetch conductor.input for executions from "unsafe" workflows (Form/App Platform triggers)
   *
   * This dramatically reduces data transfer for busy orgs where 99%+ of executions are Cron/Webhook
   * @private
   */
  async _fetchChunkAdaptiveRetryLightweight(startDay, endDay, chunkSizeIndex, workflowId, orgIds, allResults = [], options = {}) {
    const CHUNK_SIZES = RewstApp.RETRY_CHUNK_SIZES;
    const CHUNK_TIMEOUTS = RewstApp.RETRY_CHUNK_TIMEOUTS;

    let currentEnd = endDay;
    let currentChunkIndex = chunkSizeIndex;

    // Get set of workflow IDs that need full query (Form/App Platform triggers)
    const unsafeWorkflowIds = this._getUnsafeWorkflowIds();

    while (currentEnd > startDay) {
      const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
      const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
      const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 25000;

      this._log(`   [RETRY-LITE] Fetching days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (${currentChunkSize}-day chunk, ${timeoutMs/1000}s timeout)...`);

      try {
        const fetchStart = Date.now();

        // PASS 1: Lightweight query (no conductor.input, no workflow.triggers)
        const lightweightExecutions = await this._fetchExecutionsChunkSingleLightweight(
          currentStart, currentEnd, workflowId, orgIds, { timeout: timeoutMs, ...options }
        );
        const pass1Elapsed = Date.now() - fetchStart;

        this._log(`   [RETRY-LITE] Pass 1: Got ${lightweightExecutions.length} lightweight in ${pass1Elapsed}ms`);

        // PASS 2: Identify executions that need conductor.input (from unsafe workflows)
        const needsFullQuery = [];
        const safeLightweight = [];

        for (const exec of lightweightExecutions) {
          const workflowIdVal = exec.workflow?.id;
          if (workflowIdVal && unsafeWorkflowIds.has(workflowIdVal)) {
            needsFullQuery.push(exec);
          } else {
            safeLightweight.push(exec);
          }
        }

        this._log(`   [RETRY-LITE] Split: ${safeLightweight.length} safe (lightweight OK) + ${needsFullQuery.length} need conductor.input`);

        // Add safe executions directly
        allResults.push(...safeLightweight);

        // PASS 2b: Fetch conductor.input ONLY for unsafe workflow executions
        if (needsFullQuery.length > 0) {
          const pass2Start = Date.now();

          // We need to re-fetch these specific executions with full query
          // Since we can't filter by execution ID in the API, we fetch the same time range
          // but with full query, then match by ID
          const fullQueryExecutions = await this._fetchExecutionsChunkSingle(
            currentStart, currentEnd, workflowId, orgIds, { timeout: timeoutMs + 10000 } // Extra time for full query
          );
          const pass2Elapsed = Date.now() - pass2Start;

          // Build lookup map of full query results
          const fullQueryMap = new Map(fullQueryExecutions.map(e => [e.id, e]));

          // Replace lightweight with full for unsafe executions
          for (const lightExec of needsFullQuery) {
            const fullExec = fullQueryMap.get(lightExec.id);
            if (fullExec) {
              allResults.push(fullExec);
            } else {
              // Fallback to lightweight if full not found (shouldn't happen)
              allResults.push(lightExec);
            }
          }

          this._log(`   [RETRY-LITE] Pass 2: Enriched ${needsFullQuery.length} executions with conductor.input in ${pass2Elapsed}ms`);
        }

        const totalElapsed = Date.now() - fetchStart;
        if (totalElapsed > timeoutMs * 1.5 && currentChunkIndex < CHUNK_SIZES.length - 1) {
          this._log(`   [RETRY-LITE] ⚠️ Total took ${totalElapsed}ms, reducing chunk size`);
          currentChunkIndex++;
        }

        this._log(`   [RETRY-LITE] ✓ Chunk done: ${lightweightExecutions.length} total in ${totalElapsed}ms`);
        currentEnd = currentStart;

      } catch (error) {
        if (currentChunkIndex < CHUNK_SIZES.length - 1) {
          const smallerSize = CHUNK_SIZES[currentChunkIndex + 1];
          this._log(`   [RETRY-LITE] ⚠️ Failed, trying ${smallerSize}-day chunks...`);
          currentChunkIndex++;
        } else {
          // At 0.05-day (1.2 hour) minimum - skip this range and continue with the rest
          this._log(`   [RETRY-LITE] ⚠️ Skipping days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (failed at 0.05d minimum) - continuing with remaining time ranges`);
          // Track skipped range for debugging
          if (!this._skippedTimeRanges) this._skippedTimeRanges = [];
          this._skippedTimeRanges.push({ startDay: currentStart, endDay: currentEnd, orgIds });
          // Move to next chunk - STAY at smallest chunk size (don't reset to 0)
          currentEnd = currentStart;
          // Keep currentChunkIndex at the smallest size - if this org is busy, smaller chunks are needed
          continue;
        }
      }

      if (currentEnd > startDay) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return allResults;
  }

  async getRecentExecutions(includeTriggerInfo = true, daysBack = null, workflowId = null, includeRawContext = false, orgIds = null, options = {}) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getRecentExecutions called before initialization', error);
      throw error;
    }

    const timeoutMs = options.timeout || 30000; // Default 30s for backwards compatibility
    const timeRangeMsg = daysBack ? `from last ${daysBack} day(s)` : 'from all time';
    this._log(`Fetching executions ${timeRangeMsg}...`);

    // FAST PATH: If priorityWorkflowIds provided, use workflow-chunking with adaptive day ranges
    // This is MUCH faster than org-based chunking for specific workflows (e.g., forms)
    // - Chunks workflows into groups (default 10 per request)
    // - Tries large day ranges first (30, 14, 6, 3, 1 days) with adaptive fallback
    // - Processes chunks in parallel (default 6 concurrent)
    // Example: 57 forms → 6 requests instead of 100+ with org chunking
    if (options.priorityWorkflowIds && options.priorityWorkflowIds.length > 0) {
      return this._fetchExecutionsByWorkflowChunks(options.priorityWorkflowIds, daysBack, orgIds, {
        ...options,
        includeTriggerInfo,
        includeRawContext
      });
    }

    // Create a GLOBAL deadline for the entire fetch operation
    // This spans all time chunks and all orgs - prevents one org from hogging 60s per chunk
    const maxDurationMs = RewstApp.MAX_SLIDING_WINDOW_MS || 60000;
    const globalDeadline = Date.now() + maxDurationMs;
    this._log(`⏱️ Global deadline set: ${maxDurationMs/1000}s from now`);

    // Track orgs that have already been queued for retry (deadline hit)
    // These should be skipped in subsequent time chunks
    const deadlineFailedOrgs = new Set();

    // CRITICAL: Store the original full date range so failed orgs can be queued for FULL retry
    // When orgs fail mid-chunk (e.g. during chunk 21-24), they need to retry the FULL range (0-30),
    // not just the chunk they failed on
    const originalDaysBack = daysBack;

    // Declare outside try block so catch can access it for partial results
    let allExecutions = [];

    try {
      // Check if we need two-pass fetch (parents + subs separately)
      const needsTwoPassFetch = RewstApp.INCLUDE_SUB_WORKFLOWS === true;

      if (needsTwoPassFetch) {
        this._log('🔄 Two-pass fetch: Parents (full query) then subs (lightweight query)');

        // PASS 1: Fetch ONLY parents with full query
        this._log('📊 Pass 1/2: Fetching parent executions (full query)...');
        const parentsStart = Date.now();

        // Temporarily disable flag to exclude subs from first pass
        const originalFlag = RewstApp.INCLUDE_SUB_WORKFLOWS;
        RewstApp.INCLUDE_SUB_WORKFLOWS = false;

        if (daysBack && daysBack > 0) {
          allExecutions = await this._fetchChunkAdaptive(0, daysBack, 0, workflowId, orgIds, [], {
            ...options,
            globalDeadline,
            deadlineFailedOrgs,
            originalDaysBack  // Pass full range so failed orgs retry ALL days, not just the chunk they failed on
          });
        } else {
          allExecutions = await this._fetchExecutionsChunk(null, null, workflowId, orgIds, {
            ...options,
            timeout: timeoutMs,
            globalDeadline,
            deadlineFailedOrgs,
            originalDaysBack
          });
        }

        const parentsElapsed = ((Date.now() - parentsStart) / 1000).toFixed(1);
        this._log(`✅ Pass 1/2: ${allExecutions.length} parents in ${parentsElapsed}s`);

        // PASS 2: Fetch ONLY subs with lightweight query
        this._log('📊 Pass 2/2: Fetching sub-workflows (lightweight query)...');
        const subsStart = Date.now();

        // Restore flag and use lightweight query with explicit scope
        RewstApp.INCLUDE_SUB_WORKFLOWS = true;
        let subExecutions = [];

        if (daysBack && daysBack > 0) {
          subExecutions = await this._fetchChunkAdaptiveLightweight(0, daysBack, 0, workflowId, orgIds, [], {
            ...options,
            scope: 'subs',
            globalDeadline,
            deadlineFailedOrgs,
            originalDaysBack
          });
        } else {
          subExecutions = await this._fetchExecutionsChunkLightweight(null, null, workflowId, orgIds, {
            ...options,
            timeout: timeoutMs,
            scope: 'subs',
            globalDeadline,
            deadlineFailedOrgs,
            originalDaysBack
          });
        }

        const subsElapsed = ((Date.now() - subsStart) / 1000).toFixed(1);
        this._log(`✅ Pass 2/2: ${subExecutions.length} subs in ${subsElapsed}s`);

        // Restore original flag
        RewstApp.INCLUDE_SUB_WORKFLOWS = originalFlag;

        // Merge results
        allExecutions = [...allExecutions, ...subExecutions];
        const totalElapsed = ((Date.now() - parentsStart) / 1000).toFixed(1);
        this._log(`📊 Combined: ${allExecutions.length} total (${allExecutions.length - subExecutions.length} parents + ${subExecutions.length} subs) in ${totalElapsed}s`);

      } else {
        // Original single-pass logic (when INCLUDE_SUB_WORKFLOWS = false)
        // Pass through options.scope if provided (used by loadSubWorkflows button)
        if (daysBack && daysBack > 0) {
          this._log(`Using adaptive chunking (6→3→2→1→0.5→0.25→0.1 days) with progressive timeouts`);
          // Pass global deadline and deadlineFailedOrgs to skip orgs that already timed out
          allExecutions = await this._fetchChunkAdaptive(0, daysBack, 0, workflowId, orgIds, [], {
            ...options,
            globalDeadline,
            deadlineFailedOrgs,
            originalDaysBack  // Pass full range so failed orgs retry ALL days, not just the chunk they failed on
          });
          this._log(`Retrieved ${allExecutions.length} total execution(s) from adaptive chunks`);
        } else {
          this._log('Fetching all executions (no date filter - may be slow for large datasets)');
          allExecutions = await this._fetchExecutionsChunk(null, null, workflowId, orgIds, {
            timeout: timeoutMs,
            ...options,
            globalDeadline,
            deadlineFailedOrgs,
            originalDaysBack
          });
        }
      }

      // Now enrich with trigger info if requested
      if (includeTriggerInfo && allExecutions.length > 0) {
        this._log(`Fetching trigger information for ${allExecutions.length} executions (this may take a moment)...`);

        await this._buildReferenceCache();

        const result = await this._fetchTriggerInfoBatched(allExecutions, includeRawContext, { timeout: timeoutMs });
        allExecutions = result.executions;
        this._failedExecutionIds = result.failedIds; // Store for retry later
      }

      this._log(`Retrieved ${allExecutions.length} execution(s)`);
      return allExecutions;
  
    } catch (error) {
      // Handle DEADLINE_HIT specially - return partial results instead of throwing
      if (error.isDeadline) {
        this._log(`⏱️ Global deadline hit - returning ${error.partialResults?.length || 0} partial results`);
        allExecutions = error.partialResults || [];

        // Store in _failedOrgBatchRetry for retryFailedOrgBatches() to pick up
        if (!this._failedOrgBatchRetry) {
          this._failedOrgBatchRetry = {
            orgIds: [],
            chunks: [],
            workflowId,
            options: { ...options, timeout: 30000 }
          };
        }

        // CRITICAL FIX: When deadline hits mid-time-range, ALL orgs need the remaining time range
        // Not just the orgs that were in the sliding window queue
        const remainingRange = error.remainingRange;
        if (remainingRange && remainingRange.startDay < remainingRange.endDay) {
          // Queue ALL orgs for the remaining time range (e.g., days 0-3 that got cut off)
          const allOrgIds = orgIds || [this.orgId];
          this._log(`📋 DEADLINE: Queueing ALL ${allOrgIds.length} org(s) for remaining time range days ${remainingRange.startDay}-${remainingRange.endDay}`);

          for (const orgId of allOrgIds) {
            // Check if this org already has a chunk for this range
            const existingChunk = this._failedOrgBatchRetry.chunks.find(
              c => c.orgId === orgId && c.daysAgoStart === remainingRange.startDay && c.daysAgoEnd === remainingRange.endDay
            );
            if (!existingChunk) {
              if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
                this._failedOrgBatchRetry.orgIds.push(orgId);
              }
              this._failedOrgBatchRetry.chunks.push({
                orgId,
                daysAgoStart: remainingRange.startDay,
                daysAgoEnd: remainingRange.endDay
              });
            }
          }
        }

        // Also queue any orgs that individually failed (from sliding window) for FULL retry
        if (deadlineFailedOrgs.size > 0) {
          const failedOrgIds = Array.from(deadlineFailedOrgs);
          this._log(`📋 Additionally queueing ${failedOrgIds.length} sliding-window-failed org(s) for full retry`);

          for (const orgId of failedOrgIds) {
            // These orgs failed completely, so retry the full range
            const existingFullChunk = this._failedOrgBatchRetry.chunks.find(
              c => c.orgId === orgId && c.daysAgoStart === 0 && c.daysAgoEnd === (daysBack || 30)
            );
            if (!existingFullChunk) {
              if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
                this._failedOrgBatchRetry.orgIds.push(orgId);
              }
              this._failedOrgBatchRetry.chunks.push({
                orgId,
                daysAgoStart: 0,
                daysAgoEnd: daysBack || 30
              });
            }
          }
        }

        // Continue to trigger info enrichment with what we have
        if (includeTriggerInfo && allExecutions.length > 0) {
          this._log(`Fetching trigger information for ${allExecutions.length} executions (partial data)...`);
          await this._buildReferenceCache();
          const result = await this._fetchTriggerInfoBatched(allExecutions, includeRawContext, { timeout: timeoutMs });
          allExecutions = result.executions;
          this._failedExecutionIds = result.failedIds;
        }

        const totalChunks = this._failedOrgBatchRetry?.chunks?.length || 0;
        this._log(`Retrieved ${allExecutions.length} execution(s) (partial - deadline hit, ${totalChunks} org-chunks queued for retry)`);
        return allExecutions;
      }

      this._error('Failed to get recent executions', error);
      // Preserve session expired flag when re-throwing
      const wrappedError = new Error(`Failed to get recent executions: ${error.message}`);
      if (error.isSessionExpired) {
        wrappedError.isSessionExpired = true;
        wrappedError.loginUrl = error.loginUrl;
      }
      throw wrappedError;
    }
  }

  /**
   * Retry fetching trigger info for executions that failed during initial load
   * Call this after dashboard renders to fill in missing data in the background
   * Also automatically enriches Form Submission context for forms with ≤100 submissions
   * @param {object} options - Options including timeout (default 20s for background retry), enrichForms (default true)
   * @returns {Promise<object>} Object with retried (trigger info) and enriched (form context) arrays
   */
  async retryFailedTriggerInfo(options = {}) {
    const failedIds = this._failedExecutionIds || [];
    const timeoutMs = options.timeout || 20000; // Default 20s for background retry
    const shouldEnrichForms = options.enrichForms !== false; // Default true

    const updated = [];

    // Phase 1: Retry failed trigger info fetches
    if (failedIds.length > 0) {
      this._log(`🔄 Retrying ${failedIds.length} failed execution(s) with ${timeoutMs/1000}s timeout...`);

      for (const executionId of failedIds) {
        try {
          const triggerInfo = await this.getExecutionTriggerInfo(executionId, false, { timeout: timeoutMs });
          if (triggerInfo) {
            updated.push({ executionId, triggerInfo });
            this._log(`✅ Retry successful for ${executionId}`);
          }
        } catch (error) {
          this._log(`⚠️ Retry failed for ${executionId}: ${error.message}`);
        }
      }

      // Clear the failed list (or keep only the ones that still failed)
      const successfulIds = updated.map(u => u.executionId);
      this._failedExecutionIds = failedIds.filter(id => !successfulIds.includes(id));

      this._log(`🔄 Retry complete: ${updated.length}/${failedIds.length} succeeded`);
    } else {
      this._log('No failed executions to retry');
    }

    // Phase 2: Enrich Form Submission context (piggyback on this background call)
    let enriched = [];
    if (shouldEnrichForms && typeof window !== 'undefined' && window.dashboardData?.executions) {
      this._log('📝 Starting Form Submission context enrichment...');
      try {
        enriched = await this.enrichFormSubmissionContext(window.dashboardData.executions, {
          maxPerForm: options.maxPerForm || 100,
          timeout: options.formTimeout || 15000
        });

        // Merge enriched data back into dashboardData
        if (enriched.length > 0) {
          const enrichedMap = new Map(enriched.map(e => [e.executionId, e]));
          window.dashboardData.executions = window.dashboardData.executions.map(exec => {
            const enrichment = enrichedMap.get(exec.id);
            if (enrichment) {
              // Merge enriched triggerInfo into existing execution
              return {
                ...exec,
                triggerInfo: {
                  ...exec.triggerInfo,
                  ...enrichment.triggerInfo,
                  submittedInputs: enrichment.submittedInputs
                },
                user: enrichment.user || exec.user,
                _enriched: true
              };
            }
            return exec;
          });
          this._log(`📝 Merged ${enriched.length} enriched form submission(s) into dashboardData`);
        }
      } catch (error) {
        this._log(`⚠️ Form context enrichment failed: ${error.message}`);
      }
    }

    // Phase 3: Retry failed org batches (executions that timed out during initial load)
    let recoveredExecutions = [];
    if (options.retryOrgBatches !== false) {
      try {
        // Pass through options including onProgress callback
        // enrichAsYouGo=true means results come back already enriched
        const retryOptions = {
          onProgress: options.onProgress,
          enrichAsYouGo: options.enrichAsYouGo !== false // Default true
        };
        const recovered = await this.retryFailedOrgBatches(options.orgBatchTimeout || 30000, retryOptions);
        if (recovered && recovered.length > 0) {
          // Results are already enriched if enrichAsYouGo=true (default)
          recoveredExecutions = recovered;

          // Merge enriched recovered executions into dashboardData
          if (typeof window !== 'undefined' && window.dashboardData?.executions) {
            // Dedupe by execution ID
            const existingIds = new Set(window.dashboardData.executions.map(e => e.id));
            const newExecs = recoveredExecutions.filter(e => !existingIds.has(e.id));
            if (newExecs.length > 0) {
              window.dashboardData.executions.push(...newExecs);
              this._log(`📊 Merged ${newExecs.length} enriched recovered executions into dashboardData (${recoveredExecutions.length - newExecs.length} dupes skipped)`);
            }
          }
        }
      } catch (error) {
        this._log(`⚠️ Org batch retry failed: ${error.message}`);
      }
    }

    // Phase 4: Fetch missing form schemas (managed org forms not in parent's forms list)
    let fetchedForms = [];
    if (options.fetchMissingForms !== false && typeof window !== 'undefined' && window.dashboardData) {
      try {
        const missingForms = await this.fetchMissingForms(
          window.dashboardData.executions || [],
          window.dashboardData.forms || [],
          { maxForms: options.maxMissingForms || 20, timeout: options.formSchemaTimeout || 10000 }
        );

        if (missingForms.length > 0) {
          // Add to forms cache
          window.dashboardData.forms = window.dashboardData.forms || [];
          window.dashboardData.forms.push(...missingForms);
          fetchedForms = missingForms;
          this._log(`📋 Added ${missingForms.length} managed org form schema(s) to cache`);
        }
      } catch (error) {
        this._log(`⚠️ Missing forms fetch failed: ${error.message}`);
      }
    }

    // Return all results
    return { retried: updated, enriched, recoveredExecutions, fetchedForms, updated }; // 'updated' for backwards compat
  }

  /**
   * Background enrich Form Submission executions that are missing context data (submittedInputs, user)
   * Call this after dashboard renders to fill in missing form submission details
   * Only enriches forms with ≤100 submissions to avoid excessive API calls
   * @param {Array} executions - Array of execution objects from dashboard data
   * @param {object} options - Options including maxPerForm (default 100), timeout (default 15000ms)
   * @returns {Promise<Array>} Array of enriched executions that were updated
   */
  async enrichFormSubmissionContext(executions, options = {}) {
    if (!executions || executions.length === 0) {
      this._log('No executions provided for form context enrichment');
      return [];
    }

    const maxPerForm = options.maxPerForm || 100;
    const timeoutMs = options.timeout || 15000;

    // Find Form Submission executions missing submittedInputs
    // These are executions where we know it's a form submission but couldn't get full context
    const needsEnrichment = executions.filter(exec => {
      // Has Form Submission type but missing submittedInputs
      if (exec.triggerInfo?.type === 'Form Submission' && !exec.triggerInfo?.submittedInputs) {
        return true;
      }
      // Has a form object (we know it's a form) but missing submittedInputs
      if (exec.form?.id && !exec.triggerInfo?.submittedInputs) {
        return true;
      }
      // Flagged as needing retry and has form reference
      if (exec._needsRetry && exec.form?.id) {
        return true;
      }
      return false;
    });

    if (needsEnrichment.length === 0) {
      this._log('📝 No Form Submissions need context enrichment');
      return [];
    }

    this._log(`📝 Found ${needsEnrichment.length} Form Submission(s) potentially needing context enrichment`);

    // Group by formId to check counts
    const byFormId = new Map();
    for (const exec of needsEnrichment) {
      const formId = exec.form?.id || exec.triggerInfo?.formId || 'unknown';
      if (!byFormId.has(formId)) {
        byFormId.set(formId, []);
      }
      byFormId.get(formId).push(exec);
    }

    // Filter to only forms with ≤ maxPerForm submissions
    const toEnrich = [];
    const skippedForms = [];
    for (const [formId, formExecs] of byFormId) {
      if (formExecs.length <= maxPerForm) {
        toEnrich.push(...formExecs);
        this._log(`📝 Form ${formId}: ${formExecs.length} submissions - will enrich`);
      } else {
        skippedForms.push({ formId, count: formExecs.length });
        this._log(`📝 Form ${formId}: ${formExecs.length} submissions - skipping (exceeds ${maxPerForm} limit)`);
      }
    }

    if (toEnrich.length === 0) {
      this._log(`📝 All ${byFormId.size} form(s) exceed ${maxPerForm} submission limit - skipping enrichment`);
      return [];
    }

    this._log(`📝 Enriching ${toEnrich.length} Form Submission(s) from ${byFormId.size - skippedForms.length} form(s)...`);

    // Fetch context for each execution
    const updated = [];
    const batchSize = 10; // Smaller batches to avoid overwhelming API
    const delayMs = 150;

    for (let i = 0; i < toEnrich.length; i += batchSize) {
      const batch = toEnrich.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (exec) => {
          try {
            const triggerInfo = await this.getExecutionTriggerInfo(exec.id, false, { timeout: timeoutMs });

            if (triggerInfo && triggerInfo.submittedInputs) {
              this._log(`✅ Enriched form context for ${exec.id}`);
              return {
                executionId: exec.id,
                triggerInfo,
                user: triggerInfo.user || null,
                formId: triggerInfo.formId,
                formName: triggerInfo.formName,
                submittedInputs: triggerInfo.submittedInputs
              };
            }
            return null;
          } catch (error) {
            this._log(`⚠️ Failed to enrich ${exec.id}: ${error.message}`);
            return null;
          }
        })
      );

      updated.push(...batchResults.filter(r => r !== null));

      // Progress log
      const progress = Math.min(i + batchSize, toEnrich.length);
      this._log(`📝 Progress: ${progress}/${toEnrich.length} processed`);

      // Small delay between batches
      if (i + batchSize < toEnrich.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    this._log(`📝 Form context enrichment complete: ${updated.length}/${toEnrich.length} enriched`);
    if (skippedForms.length > 0) {
      this._log(`📝 Skipped ${skippedForms.length} form(s) with >100 submissions`);
    }

    return updated;
  }

/**
 * Infer trigger type from conductor.input without fetching full context
 * @private
 * @param {Object} conductorInput - The conductor.input object from execution
 * @returns {Object|null} Inferred trigger info or null if can't determine
 */
_inferTriggerTypeFromInput(conductorInput) {
  if (!conductorInput) return null;

  const keys = Object.keys(conductorInput);

  // Cron Job: has cron, timezone, triggered_at
  if (keys.includes('cron') && keys.includes('timezone') && keys.includes('triggered_at')) {
    return {
      type: 'Cron Job',
      typeRef: 'core.Cron Job',
      inferredFrom: 'conductor.input'
    };
  }

  // Webhook: has method, headers, body, params, timestamp
  if (keys.includes('method') && keys.includes('headers') && keys.includes('body')) {
    return {
      type: 'Webhook',
      typeRef: 'core.Webhook',
      inferredFrom: 'conductor.input'
    };
  }

  // App Platform: has $pageId, $siteId, or other $ prefixed keys
  const hasDollarKeys = keys.some(k => k.startsWith('$'));
  if (hasDollarKeys) {
    return {
      type: 'App Platform',
      typeRef: 'core.App Platform',
      inferredFrom: 'conductor.input'
    };
  }

  // App Platform: empty input (common for app platform triggers)
  if (keys.length === 0) {
    return {
      type: 'App Platform',
      typeRef: 'core.App Platform',
      inferredFrom: 'conductor.input (empty)'
    };
  }

  // Can't determine - need to fetch context
  return null;
}


/**
 * Fetch executions for many orgs by batching into parallel queries.
 * Uses "early return" strategy: returns results once most batches complete,
 * continues slow batches in background for later merge.
 * @private
 */
async _fetchExecutionsMultiOrg(daysAgoStart, daysAgoEnd, workflowId, orgIds, options = {}) {
  const batchSize = RewstApp.ORG_BATCH_SIZE;
  const batches = [];

  // Split orgIds into batches
  for (let i = 0; i < orgIds.length; i += batchSize) {
    batches.push(orgIds.slice(i, i + batchSize));
  }

  const totalBatches = batches.length;
  const maxWaitMs = 120000; // Max 2 min before returning with what we have

  // Use standard timeout for initial parallel batches - faster initial render
  // Failed orgs will be retried in background with longer timeouts
  const batchOptions = { ...options, timeout: options.timeout || 10000 };

  this._log(`Fetching ${orgIds.length} orgs in ${totalBatches} batches (${maxWaitMs/1000}s max wait, ${batchOptions.timeout/1000}s per-batch timeout)`);

  const batchStartTime = Date.now();
  const completedResults = [];
  const pendingBatches = new Map(); // Track which batches are still running

  // Fire off all batches with small stagger to avoid hammering API
  const batchPromises = batches.map((batchOrgIds, index) => {
    const batchNum = index + 1;

    // Stagger batch starts by 30ms each
    return new Promise(resolve => setTimeout(resolve, index * 30))
      .then(() => {
        const startTime = Date.now();
        pendingBatches.set(batchNum, { startTime, orgCount: batchOrgIds.length });
        this._log(`🚀 Batch ${batchNum}/${totalBatches} starting (${batchOrgIds.length} orgs)`);

        return this._fetchExecutionsChunkSingle(daysAgoStart, daysAgoEnd, workflowId, batchOrgIds, batchOptions)
          .then(results => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            pendingBatches.delete(batchNum);
            completedResults.push({ results, batchIndex: batchNum, elapsed: parseFloat(elapsed), success: true });
            this._log(`✅ Batch ${batchNum} done in ${elapsed}s: ${results.length} execs (${completedResults.length}/${totalBatches})`);
            return { results, batchIndex: batchNum, success: true };
          })
          .catch(error => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            pendingBatches.delete(batchNum);
            completedResults.push({ results: [], batchIndex: batchNum, elapsed: parseFloat(elapsed), success: false, failedOrgIds: batchOrgIds });
            this._error(`❌ Batch ${batchNum} FAILED after ${elapsed}s (${batchOrgIds.length} orgs)`, error);
            return { results: [], batchIndex: batchNum, success: false, failedOrgIds: batchOrgIds };
          });
      });
  });

  // Wait for all batches OR timeout (whichever comes first)
  const timeoutPromise = new Promise(resolve => setTimeout(() => {
    this._log(`⏱️ Max wait ${maxWaitMs/1000}s reached, returning with ${completedResults.length}/${totalBatches} batches`);
    resolve();
  }, maxWaitMs));

  await Promise.race([Promise.all(batchPromises), timeoutPromise]);

  const totalElapsed = ((Date.now() - batchStartTime) / 1000).toFixed(1);

  // Log what's still pending
  if (pendingBatches.size > 0) {
    const pendingList = Array.from(pendingBatches.entries())
      .map(([num, info]) => `#${num}(${((Date.now() - info.startTime)/1000).toFixed(0)}s)`)
      .join(', ');
    this._log(`📊 Returning with ${completedResults.length}/${totalBatches} batches in ${totalElapsed}s`);
    this._log(`   ⏳ Still running: ${pendingList} - will merge when done`);

    // Store pending promises for background completion
    this._pendingOrgBatches = {
      promises: batchPromises.filter((_, i) => pendingBatches.has(i + 1)),
      startTime: batchStartTime
    };
  } else {
    this._log(`📊 All ${totalBatches} batches complete in ${totalElapsed}s`);
    this._pendingOrgBatches = null;
  }

  // Check for failures that should trigger adaptive chunk retry
  const successfulBatches = completedResults.filter(b => b.success);
  const failedBatches = completedResults.filter(b => !b.success);
  const allExecutions = completedResults.flatMap(b => b.results);

  // Diagnostic logging
  this._log(`📈 Batch results: ${successfulBatches.length} succeeded, ${failedBatches.length} failed, ${pendingBatches.size} still pending`);
  if (failedBatches.length > 0) {
    this._log(`   Failed batch details: ${failedBatches.map(b => `#${b.batchIndex}(${b.failedOrgIds?.length || 0} orgs)`).join(', ')}`);
  }

  // FIRST: Always store failed orgs for background retry (individual 30s each)
  // ACCUMULATE across time chunks instead of overwriting
  if (failedBatches.length > 0) {
    const failedOrgIds = failedBatches.flatMap(b => b.failedOrgIds || []);
    this._log(`⚠️ ${failedBatches.length} batch(es) failed (${failedOrgIds.length} orgs), got ${allExecutions.length} executions from others`);

    if (failedOrgIds.length > 0) {
      // Initialize accumulator if needed
      if (!this._failedOrgBatchRetry) {
        this._failedOrgBatchRetry = {
          orgIds: [],
          chunks: [], // Track which time chunks failed for each org
          workflowId,
          options
        };
      }

      // CRITICAL FIX: When orgs fail, they need to retry from day 0 to where they failed,
      // NOT just the current chunk. If originalDaysBack is provided, use that.
      const retryEndDay = options.originalDaysBack || daysAgoEnd;

      // Add failed orgs with FULL time range (0 to retryEndDay)
      failedOrgIds.forEach(orgId => {
        // Add chunk info for this org - use 0 as start since we need ALL data
        const chunkInfo = { orgId, daysAgoStart: 0, daysAgoEnd: retryEndDay };
        this._failedOrgBatchRetry.chunks.push(chunkInfo);

        // Add to orgIds if not already there
        if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
          this._failedOrgBatchRetry.orgIds.push(orgId);
        }
      });

      this._log(`📋 Accumulated ${this._failedOrgBatchRetry.orgIds.length} unique failed org(s) for background retry (0-${retryEndDay} days)`);
    }
  } else if (successfulBatches.length > 0) {
    this._log(`✅ All ${successfulBatches.length} completed batch(es) succeeded`);
  }

  // DON'T throw to retry with smaller time chunks - just return what we have
  // The failed orgs are already queued for individual 30s background retry
  // This prevents the infinite loop of re-batching the same orgs over and over

  this._log(`Returning ${allExecutions.length} executions (${pendingBatches.size} batches still loading in background)`);

  return allExecutions;
}

/**
 * Check if there are pending org batches and get their results
 * Call this after initial render to merge in late-arriving data
 * @returns {Promise<Array|null>} Additional executions or null if none pending
 */
async getPendingOrgBatchResults() {
  if (!this._pendingOrgBatches || !this._pendingOrgBatches.promises.length) {
    return null;
  }

  this._log(`🔄 Waiting for ${this._pendingOrgBatches.promises.length} pending org batches...`);

  try {
    const results = await Promise.all(this._pendingOrgBatches.promises);
    const additionalExecutions = results.flatMap(r => r.results || []);
    this._log(`✅ Pending batches complete: ${additionalExecutions.length} additional executions`);

    this._pendingOrgBatches = null;
    return additionalExecutions;
  } catch (error) {
    this._error('Failed to get pending batch results', error);
    this._pendingOrgBatches = null;
    return null;
  }
}

/**
 * Fetch executions using sliding window (staggered parallel processing)
 * For small org counts (≤10) where sub-workflow data causes timeouts in batches
 * Has a hard deadline (MAX_SLIDING_WINDOW_MS) - after which it stops and moves remaining to retry
 */
async _fetchExecutionsMultiOrgSliding(daysAgoStart, daysAgoEnd, workflowId, orgIds, options = {}) {
  const { onProgress, globalDeadline, deadlineFailedOrgs } = options;
  const windowSize = RewstApp.ORG_WINDOW_SIZE || 3;
  const maxDurationMs = RewstApp.MAX_SLIDING_WINDOW_MS || 60000;

  // Use globalDeadline if provided (from getRecentExecutions), otherwise create a local one
  // This ensures one 60s deadline spans ALL time chunks, not 60s per chunk
  const deadline = globalDeadline || (Date.now() + maxDurationMs);
  const isGlobalDeadline = !!globalDeadline;

  // Filter out orgs that already hit deadline in previous time chunks
  const orgsToProcess = deadlineFailedOrgs
    ? orgIds.filter(id => !deadlineFailedOrgs.has(id))
    : orgIds;

  if (orgsToProcess.length < orgIds.length) {
    this._log(`🪟 Sliding window: ${orgsToProcess.length} orgs (${orgIds.length - orgsToProcess.length} already failed, skipping), ${windowSize} at a time${isGlobalDeadline ? ' (GLOBAL deadline)' : ''}`);
  } else {
    this._log(`🪟 Sliding window: ${orgIds.length} orgs, ${windowSize} at a time${isGlobalDeadline ? ' (GLOBAL deadline)' : ''}`);
  }

  const allExecutions = [];
  const failedOrgIds = [];
  let completedCount = 0;
  let deadlineHit = false;

  // Queue management (same pattern as retryFailedOrgBatches)
  const queue = [...orgsToProcess];
  const activePromises = new Map();
  const activeOrgIds = new Set(); // Track which orgs are currently in-flight

  const processOrg = async (orgId, orgIndex) => {
    const startTime = Date.now();
    this._log(`🔍 [${orgIndex + 1}/${orgsToProcess.length}] Org ${orgId.slice(0, 8)}`);

    try {
      // For single-org fetch within sliding window, use direct chunk fetch (no nested sliding window)
      const orgExecs = await this._fetchChunkAdaptiveSingleOrg(
        daysAgoStart, daysAgoEnd, 0, workflowId, orgId, [],
        { ...options, timeout: 20000, deadline }  // 20s per org max (respects 60s global deadline)
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this._log(`✅ [${orgIndex + 1}/${orgsToProcess.length}] ${orgExecs.length} execs in ${elapsed}s`);

      return { success: true, results: orgExecs, orgId };
    } catch (error) {
      // Handle deadline error specially - keep partial results, queue remaining range
      if (error.isDeadline) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const partialCount = error.partialResults?.length || 0;
        this._log(`⏰ [${orgIndex + 1}/${orgsToProcess.length}] DEADLINE after ${elapsed}s - keeping ${partialCount} partial results`);
        return {
          success: false,
          results: error.partialResults || [],
          orgId,
          remainingRange: error.remainingRange,
          isDeadline: true
        };
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this._error(`❌ [${orgIndex + 1}/${orgsToProcess.length}] FAILED after ${elapsed}s`, error);
      return { success: false, results: [], orgId };
    }
  };

  // Track partial ranges that need retry (deadline hit mid-chunk)
  const partialRanges = [];

  const processResult = (result) => {
    activeOrgIds.delete(result.orgId);
    if (result.results.length > 0) {
      allExecutions.push(...result.results);
    }
    if (!result.success) {
      // For deadline with partial results, store the remaining range specifically
      if (result.isDeadline && result.remainingRange) {
        partialRanges.push({
          orgId: result.orgId,
          ...result.remainingRange
        });
        // Mark deadline hit so we stop the loop
        deadlineHit = true;
        // Add to deadlineFailedOrgs so this org is skipped in subsequent time chunks
        if (deadlineFailedOrgs) {
          deadlineFailedOrgs.add(result.orgId);
        }
      } else {
        failedOrgIds.push(result.orgId);
        // Also add non-deadline failures to skip in subsequent chunks
        if (deadlineFailedOrgs) {
          deadlineFailedOrgs.add(result.orgId);
        }
      }
    }
    completedCount++;

    // Report progress
    if (onProgress) {
      onProgress({
        phase: 'sliding_window',
        completed: completedCount,
        total: orgsToProcess.length,
        executions: allExecutions.length,
        status: `Loaded ${completedCount}/${orgsToProcess.length} orgs`
      });
    }
  };

  let orgIndex = 0;

  // Start initial window
  while (activePromises.size < windowSize && queue.length > 0) {
    const orgId = queue.shift();
    activeOrgIds.add(orgId);
    const promise = processOrg(orgId, orgIndex++).then(result => {
      processResult(result);
      activePromises.delete(orgId);
      return result;
    });
    activePromises.set(orgId, promise);
  }

  // Process remaining with sliding window - but respect deadline
  while (activePromises.size > 0) {
    // Check deadline before waiting
    if (Date.now() > deadline) {
      deadlineHit = true;
      this._log(`⏰ DEADLINE HIT (${maxDurationMs/1000}s) - stopping sliding window, ${queue.length} orgs in queue, ${activePromises.size} in-flight`);
      break;
    }

    await Promise.race(activePromises.values());

    // Check deadline again after completing an org
    if (Date.now() > deadline) {
      deadlineHit = true;
      this._log(`⏰ DEADLINE HIT (${maxDurationMs/1000}s) - stopping sliding window, ${queue.length} orgs in queue, ${activePromises.size} in-flight`);
      break;
    }

    while (activePromises.size < windowSize && queue.length > 0) {
      const orgId = queue.shift();
      activeOrgIds.add(orgId);
      const promise = processOrg(orgId, orgIndex++).then(result => {
        processResult(result);
        activePromises.delete(orgId);
        return result;
      });
      activePromises.set(orgId, promise);
    }
  }

  // If deadline hit, we need to handle remaining orgs
  if (deadlineHit) {
    // Wait for active promises to settle (they'll finish on their own, we just won't start new ones)
    // Use Promise.allSettled so we don't block forever - give them 5 more seconds max
    const remainingTimeout = 5000;
    const settlePromise = Promise.allSettled(activePromises.values());
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), remainingTimeout));

    const settleResult = await Promise.race([settlePromise, timeoutPromise]);

    if (settleResult === 'timeout') {
      this._log(`⚠️ Active orgs didn't finish in ${remainingTimeout/1000}s grace period - moving to retry`);
      // Any orgs still in activeOrgIds are considered failed
      activeOrgIds.forEach(orgId => {
        if (!failedOrgIds.includes(orgId)) {
          failedOrgIds.push(orgId);
        }
      });
    }

    // All orgs still in queue go to retry
    queue.forEach(orgId => {
      if (!failedOrgIds.includes(orgId)) {
        failedOrgIds.push(orgId);
      }
    });

    this._log(`📋 Deadline caused ${failedOrgIds.length} org(s) to be moved to retry queue`);
  }

  // Store failed orgs for potential retry
  if (failedOrgIds.length > 0 || partialRanges.length > 0) {
    if (!this._failedOrgBatchRetry) {
      this._failedOrgBatchRetry = {
        orgIds: [],
        chunks: [],
        workflowId,
        options
      };
    }

    // CRITICAL FIX: When orgs fail, they need to retry from day 0 to where they failed (daysAgoEnd),
    // NOT just the current chunk (daysAgoStart to daysAgoEnd).
    // Why: Chunks are processed backward (30→24→21→18→...). If deadline hits at chunk 21-24,
    // we have data for 24-30 but NOT for 0-24. The retry must cover 0-24.
    // If originalDaysBack is provided, use that as the full end range to be safe.
    const retryEndDay = options.originalDaysBack || daysAgoEnd;

    // Completely failed orgs - retry from day 0 to where they failed
    failedOrgIds.forEach(orgId => {
      this._failedOrgBatchRetry.chunks.push({ orgId, daysAgoStart: 0, daysAgoEnd: retryEndDay });
      if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
        this._failedOrgBatchRetry.orgIds.push(orgId);
      }
    });

    // Partial deadline results - they got SOME data for THIS chunk, but still need ALL earlier chunks
    // The remainingRange from the error only tells us where THIS chunk stopped, not all the chunks we missed
    // Since chunks process backward (30→24→21→...), if we hit deadline at chunk 24-27, we have data for 27-30
    // but NOT for 0-27. So we need to retry from 0 to retryEndDay (the full range).
    partialRanges.forEach(({ orgId, startDay, endDay, chunkSizeIndex }) => {
      this._failedOrgBatchRetry.chunks.push({
        orgId,
        daysAgoStart: 0,  // CRITICAL: Retry from day 0, not from where this chunk stopped
        daysAgoEnd: retryEndDay,  // Use full range end
        chunkSizeIndex: chunkSizeIndex || 0
      });
      if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
        this._failedOrgBatchRetry.orgIds.push(orgId);
      }
    });

    this._log(`📋 ${failedOrgIds.length} org(s) failed + ${partialRanges.length} partial(s), all retry 0-${retryEndDay} days`);
  }

  this._log(`📊 Sliding window complete: ${allExecutions.length} executions from ${completedCount} orgs${deadlineHit ? ' (deadline hit)' : ''}`);
  return allExecutions;
}

/**
 * Fetch executions using sliding window with LIGHTWEIGHT query
 * Same as _fetchExecutionsMultiOrgSliding but uses lightweight adaptive fetch
 * Has a hard deadline (MAX_SLIDING_WINDOW_MS) - after which it stops and moves remaining to retry
 * @private
 */
async _fetchExecutionsMultiOrgSlidingLightweight(daysAgoStart, daysAgoEnd, workflowId, orgIds, options = {}) {
  const { onProgress, globalDeadline, deadlineFailedOrgs } = options;
  const windowSize = RewstApp.ORG_WINDOW_SIZE || 3;
  const maxDurationMs = RewstApp.MAX_SLIDING_WINDOW_MS || 60000;

  // Use globalDeadline if provided (from getRecentExecutions), otherwise create a local one
  const deadline = globalDeadline || (Date.now() + maxDurationMs);
  const isGlobalDeadline = !!globalDeadline;

  // Filter out orgs that already hit deadline in previous time chunks
  const orgsToProcess = deadlineFailedOrgs
    ? orgIds.filter(id => !deadlineFailedOrgs.has(id))
    : orgIds;

  if (orgsToProcess.length < orgIds.length) {
    this._log(`🪟 Sliding window (lightweight): ${orgsToProcess.length} orgs (${orgIds.length - orgsToProcess.length} already failed, skipping), ${windowSize} at a time${isGlobalDeadline ? ' (GLOBAL deadline)' : ''}`);
  } else {
    this._log(`🪟 Sliding window (lightweight): ${orgIds.length} orgs, ${windowSize} at a time${isGlobalDeadline ? ' (GLOBAL deadline)' : ''}`);
  }

  const allExecutions = [];
  const failedOrgIds = [];
  let completedCount = 0;
  let deadlineHit = false;

  // Queue management (same pattern as retryFailedOrgBatches)
  const queue = [...orgsToProcess];
  const activePromises = new Map();
  const activeOrgIds = new Set(); // Track which orgs are currently in-flight

  const processOrg = async (orgId, orgIndex) => {
    const startTime = Date.now();
    this._log(`🔍 [Lightweight ${orgIndex + 1}/${orgsToProcess.length}] Org ${orgId.slice(0, 8)}`);

    try {
      // For single-org fetch within sliding window, use direct chunk fetch (no nested sliding window)
      const orgExecs = await this._fetchChunkAdaptiveSingleOrgLightweight(
        daysAgoStart, daysAgoEnd, 0, workflowId, orgId, [],
        { timeout: 20000, deadline, ...options }  // 20s per org max (respects 60s global deadline)
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this._log(`✅ [Lightweight ${orgIndex + 1}/${orgsToProcess.length}] ${orgExecs.length} execs in ${elapsed}s`);

      return { success: true, results: orgExecs, orgId };
    } catch (error) {
      // Handle deadline error specially - keep partial results, queue remaining range
      if (error.isDeadline) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const partialCount = error.partialResults?.length || 0;
        this._log(`⏰ [Lightweight ${orgIndex + 1}/${orgsToProcess.length}] DEADLINE after ${elapsed}s - keeping ${partialCount} partial results`);
        return {
          success: false,
          results: error.partialResults || [],
          orgId,
          remainingRange: error.remainingRange,
          isDeadline: true
        };
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this._error(`❌ [Lightweight ${orgIndex + 1}/${orgsToProcess.length}] FAILED after ${elapsed}s`, error);
      return { success: false, results: [], orgId };
    }
  };

  // Track partial ranges that need retry (deadline hit mid-chunk)
  const partialRanges = [];

  const processResult = (result) => {
    activeOrgIds.delete(result.orgId);
    if (result.results.length > 0) {
      allExecutions.push(...result.results);
    }
    if (!result.success) {
      // For deadline with partial results, store the remaining range specifically
      if (result.isDeadline && result.remainingRange) {
        partialRanges.push({
          orgId: result.orgId,
          ...result.remainingRange
        });
        // Mark deadline hit so we stop the loop
        deadlineHit = true;
        // Add to deadlineFailedOrgs so this org is skipped in subsequent time chunks
        if (deadlineFailedOrgs) {
          deadlineFailedOrgs.add(result.orgId);
        }
      } else {
        failedOrgIds.push(result.orgId);
        // Also add non-deadline failures to skip in subsequent chunks
        if (deadlineFailedOrgs) {
          deadlineFailedOrgs.add(result.orgId);
        }
      }
    }
    completedCount++;

    // Report progress
    if (onProgress) {
      onProgress({
        phase: 'sliding_window_lightweight',
        completed: completedCount,
        total: orgsToProcess.length,
        executions: allExecutions.length,
        status: `Loaded ${completedCount}/${orgsToProcess.length} orgs (lightweight)`
      });
    }
  };

  let orgIndex = 0;

  // Start initial window
  while (activePromises.size < windowSize && queue.length > 0) {
    const orgId = queue.shift();
    activeOrgIds.add(orgId);
    const promise = processOrg(orgId, orgIndex++).then(result => {
      processResult(result);
      activePromises.delete(orgId);
      return result;
    });
    activePromises.set(orgId, promise);
  }

  // Process remaining with sliding window - but respect deadline
  while (activePromises.size > 0) {
    // Check deadline before waiting
    if (Date.now() > deadline) {
      deadlineHit = true;
      this._log(`⏰ DEADLINE HIT (${maxDurationMs/1000}s) - stopping lightweight sliding window, ${queue.length} orgs in queue, ${activePromises.size} in-flight`);
      break;
    }

    await Promise.race(activePromises.values());

    // Check deadline again after completing an org
    if (Date.now() > deadline) {
      deadlineHit = true;
      this._log(`⏰ DEADLINE HIT (${maxDurationMs/1000}s) - stopping lightweight sliding window, ${queue.length} orgs in queue, ${activePromises.size} in-flight`);
      break;
    }

    while (activePromises.size < windowSize && queue.length > 0) {
      const orgId = queue.shift();
      activeOrgIds.add(orgId);
      const promise = processOrg(orgId, orgIndex++).then(result => {
        processResult(result);
        activePromises.delete(orgId);
        return result;
      });
      activePromises.set(orgId, promise);
    }
  }

  // If deadline hit, we need to handle remaining orgs
  if (deadlineHit) {
    // Wait for active promises to settle (they'll finish on their own, we just won't start new ones)
    // Use Promise.allSettled so we don't block forever - give them 5 more seconds max
    const remainingTimeout = 5000;
    const settlePromise = Promise.allSettled(activePromises.values());
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), remainingTimeout));

    const settleResult = await Promise.race([settlePromise, timeoutPromise]);

    if (settleResult === 'timeout') {
      this._log(`⚠️ Active orgs didn't finish in ${remainingTimeout/1000}s grace period - moving to retry`);
      // Any orgs still in activeOrgIds are considered failed
      activeOrgIds.forEach(orgId => {
        if (!failedOrgIds.includes(orgId)) {
          failedOrgIds.push(orgId);
        }
      });
    }

    // All orgs still in queue go to retry
    queue.forEach(orgId => {
      if (!failedOrgIds.includes(orgId)) {
        failedOrgIds.push(orgId);
      }
    });

    this._log(`📋 Deadline caused ${failedOrgIds.length} org(s) to be moved to retry queue (lightweight)`);
  }

  // Store failed orgs for potential retry
  if (failedOrgIds.length > 0 || partialRanges.length > 0) {
    if (!this._failedOrgBatchRetry) {
      this._failedOrgBatchRetry = {
        orgIds: [],
        chunks: [],
        workflowId,
        options
      };
    }

    // CRITICAL FIX: When orgs fail, they need to retry from day 0 to where they failed (daysAgoEnd),
    // NOT just the current chunk (daysAgoStart to daysAgoEnd).
    // Why: Chunks are processed backward (30→24→21→18→...). If deadline hits at chunk 21-24,
    // we have data for 24-30 but NOT for 0-24. The retry must cover 0-24.
    // If originalDaysBack is provided, use that as the full end range to be safe.
    const retryEndDay = options.originalDaysBack || daysAgoEnd;

    // Completely failed orgs - retry from day 0 to where they failed
    failedOrgIds.forEach(orgId => {
      this._failedOrgBatchRetry.chunks.push({ orgId, daysAgoStart: 0, daysAgoEnd: retryEndDay });
      if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
        this._failedOrgBatchRetry.orgIds.push(orgId);
      }
    });

    // Partial deadline results - they got SOME data for THIS chunk, but still need ALL earlier chunks
    // Since chunks process backward (30→24→21→...), we need to retry from 0 to retryEndDay
    partialRanges.forEach(({ orgId, startDay, endDay, chunkSizeIndex }) => {
      this._failedOrgBatchRetry.chunks.push({
        orgId,
        daysAgoStart: 0,  // CRITICAL: Retry from day 0, not from where this chunk stopped
        daysAgoEnd: retryEndDay,
        chunkSizeIndex: chunkSizeIndex || 0
      });
      if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
        this._failedOrgBatchRetry.orgIds.push(orgId);
      }
    });

    this._log(`📋 ${failedOrgIds.length} org(s) failed + ${partialRanges.length} partial(s), all retry 0-${retryEndDay} days (lightweight)`);
  }

  this._log(`📊 Sliding window (lightweight) complete: ${allExecutions.length} executions from ${completedCount} orgs${deadlineHit ? ' (deadline hit)' : ''}`);
  return allExecutions;
}

/**
 * Fetch executions for many orgs by batching with LIGHTWEIGHT query
 * Simplified version that uses lightweight single query for each batch
 * @private
 */
async _fetchExecutionsMultiOrgLightweight(daysAgoStart, daysAgoEnd, workflowId, orgIds, options = {}) {
  const batchSize = RewstApp.ORG_BATCH_SIZE;
  const batches = [];

  // Split orgIds into batches
  for (let i = 0; i < orgIds.length; i += batchSize) {
    batches.push(orgIds.slice(i, i + batchSize));
  }

  const totalBatches = batches.length;
  const batchOptions = { ...options, timeout: options.timeout || 10000 };

  this._log(`Fetching (lightweight) ${orgIds.length} orgs in ${totalBatches} batches`);

  const allExecutions = [];

  // Process batches in parallel
  const batchPromises = batches.map((batchOrgIds, index) => {
    const batchNum = index + 1;

    return new Promise(resolve => setTimeout(resolve, index * 30))
      .then(() => {
        const startTime = Date.now();
        this._log(`🚀 Batch ${batchNum}/${totalBatches} starting (lightweight, ${batchOrgIds.length} orgs)`);

        return this._fetchExecutionsChunkSingleLightweight(daysAgoStart, daysAgoEnd, workflowId, batchOrgIds, batchOptions)
          .then(results => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            this._log(`✅ Batch ${batchNum} (lightweight) done in ${elapsed}s: ${results.length} execs`);
            return results;
          })
          .catch(error => {
            this._error(`❌ Batch ${batchNum} (lightweight) FAILED`, error);
            return [];
          });
      });
  });

  const results = await Promise.all(batchPromises);
  results.forEach(batchResults => {
    if (batchResults.length > 0) {
      allExecutions.push(...batchResults);
    }
  });

  this._log(`Returning ${allExecutions.length} executions (lightweight batching)`);
  return allExecutions;
}

/**
 * Retry failed org batches in the background
 * Call this after dashboard renders to recover data from orgs that timed out
 * Now handles ACCUMULATED failures from multiple time chunks
 * @param {number} timeoutMs - Timeout per org/chunk (default 30s)
 * @param {object} retryOptions - Additional options
 * @param {function} retryOptions.onProgress - Callback for progress updates: ({ completed, total, enrichedCount }) => void
 * @param {boolean} retryOptions.enrichAsYouGo - Enrich each org's results immediately (default: true)
 * @param {boolean} retryOptions.useLightweight - Use lightweight-first approach (default: true) - fetches without conductor.input first, then only fetches full data for Form/App Platform workflows
 * @returns {Promise<Array|null>} Recovered AND enriched executions or null if none
 */
async retryFailedOrgBatches(timeoutMs = 30000, retryOptions = {}) {
  const { onProgress, enrichAsYouGo = true, useLightweight = false } = retryOptions;

  if (!this._failedOrgBatchRetry) {
    this._log('📋 No failed org batches to retry');
    return null;
  }

  const { orgIds, chunks, workflowId, options } = this._failedOrgBatchRetry;
  this._failedOrgBatchRetry = null; // Clear so we don't retry twice

  if (!orgIds || orgIds.length === 0 || !chunks || chunks.length === 0) {
    return null;
  }

  // Merge overlapping time ranges per org to get the full date range needed
  // Then we'll use adaptive chunking (same as main fetch) to handle timeouts smartly
  const orgDateRanges = new Map();
  chunks.forEach(chunk => {
    if (!orgDateRanges.has(chunk.orgId)) {
      orgDateRanges.set(chunk.orgId, { start: Infinity, end: 0 });
    }
    const range = orgDateRanges.get(chunk.orgId);
    range.start = Math.min(range.start, chunk.daysAgoStart);
    range.end = Math.max(range.end, chunk.daysAgoEnd);
  });

  const PARALLEL_LIMIT = 5; // Keep 5 running at all times (sliding window)
  const modeDesc = useLightweight ? 'LIGHTWEIGHT-FIRST (2-pass)' : 'FULL QUERY';
  this._log(`🔄 BACKGROUND RETRY STARTING: ${orgIds.length} org(s) with ${modeDesc} + SLIDING WINDOW (${PARALLEL_LIMIT} concurrent)...`);

  const retryResults = []; // Will hold ENRICHED results if enrichAsYouGo=true
  const stillFailed = new Set();
  const abandonedOrgs = new Set(); // Track orgs that we gave up on
  let completedCount = 0;
  let enrichedCount = 0; // Track how many executions have been enriched

  // Create retry task for each org - uses _fetchChunkAdaptiveRetry (3-day min, 25s max timeout)
  // If enrichAsYouGo=true, also enriches the results before returning
  const retryOrgTask = async (orgId) => {
    const orgShort = orgId.slice(0, 8);
    const range = orgDateRanges.get(orgId);
    const rangeDesc = `days ${range.start.toFixed(1)}-${range.end.toFixed(1)}`;

    try {
      this._log(`   🔄 Continuing org ${orgShort}... ${rangeDesc} (${useLightweight ? 'lightweight' : 'full'})`);

      // Use lightweight-first approach if enabled (default), otherwise full query
      // Pass through options (includes excludeWorkflowIds for busy workflow exclusion)
      const orgResults = useLightweight
        ? await this._fetchChunkAdaptiveRetryLightweight(range.start, range.end, 0, workflowId, [orgId], [], options)
        : await this._fetchChunkAdaptiveRetry(range.start, range.end, 0, workflowId, [orgId], [], options);

      completedCount++;
      const progress = `[${completedCount}/${orgIds.length}]`;

      if (orgResults.length > 0) {
        // Enrich immediately if enabled (parallel with other orgs still fetching)
        let finalResults = orgResults;
        if (enrichAsYouGo) {
          try {
            this._log(`   ${progress} 📊 Enriching ${orgResults.length} from ${orgShort}...`);
            const enrichResult = await this._fetchTriggerInfoBatched(orgResults, false, { timeout: 15000 });
            finalResults = enrichResult.executions;
            enrichedCount += finalResults.length;
          } catch (enrichError) {
            this._log(`   ${progress} ⚠️ Enrichment failed for ${orgShort}, using raw results`);
            // Fall back to raw results
          }
        }
        this._log(`   ${progress} ✅ Got ${finalResults.length} from ${orgShort}...`);
        return { success: true, results: finalResults, orgId, abandoned: false };
      } else {
        this._log(`   ${progress} ⚪ ${orgShort}... returned 0`);
        return { success: true, results: [], orgId, abandoned: false };
      }
    } catch (error) {
      completedCount++;
      const progress = `[${completedCount}/${orgIds.length}]`;
      const isAbandoned = error.message?.includes('RETRY_ABANDONED');
      if (isAbandoned) {
        this._log(`   ${progress} 🚫 ${orgShort}... ABANDONED (too slow even at 3-day chunks)`);
      } else {
        this._log(`   ${progress} ❌ ${orgShort}... FAILED: ${error.message}`);
      }
      return { success: false, results: [], orgId, abandoned: isAbandoned };
    }
  };

  // SLIDING WINDOW: Keep PARALLEL_LIMIT running at all times
  // As soon as one finishes, start the next - don't wait for whole batch
  const queue = [...orgIds];
  const activePromises = new Map(); // orgId -> promise

  const processResult = (result) => {
    if (result.results.length > 0) {
      retryResults.push(...result.results);
    }
    if (!result.success) {
      stillFailed.add(result.orgId);
    }
    if (result.abandoned) {
      abandonedOrgs.add(result.orgId);
    }
    activePromises.delete(result.orgId);

    // Call progress callback if provided
    if (onProgress) {
      try {
        onProgress({
          completed: completedCount,
          total: orgIds.length,
          enrichedCount: enrichAsYouGo ? enrichedCount : retryResults.length,
          abandoned: abandonedOrgs.size
        });
      } catch (e) {
        // Ignore callback errors
      }
    }
  };

  // Start initial batch
  while (activePromises.size < PARALLEL_LIMIT && queue.length > 0) {
    const orgId = queue.shift();
    const promise = retryOrgTask(orgId).then(result => {
      processResult(result);
      return result;
    });
    activePromises.set(orgId, promise);
  }

  // Process remaining with sliding window
  while (activePromises.size > 0) {
    // Wait for ANY one to complete
    await Promise.race(activePromises.values());

    // Start new tasks to keep PARALLEL_LIMIT running
    while (activePromises.size < PARALLEL_LIMIT && queue.length > 0) {
      const orgId = queue.shift();
      const promise = retryOrgTask(orgId).then(result => {
        processResult(result);
        return result;
      });
      activePromises.set(orgId, promise);
    }
  }

  const stillFailedArray = Array.from(stillFailed);
  const abandonedArray = Array.from(abandonedOrgs);
  const successfulOrgs = orgIds.length - stillFailedArray.length;

  // Log completion with abandoned org info
  if (retryResults.length > 0) {
    let msg = `🎉 BACKGROUND RETRY COMPLETE: Recovered ${retryResults.length} executions from ${successfulOrgs}/${orgIds.length} orgs`;
    if (abandonedArray.length > 0) {
      msg += ` (${abandonedArray.length} org(s) abandoned - too slow)`;
    }
    this._log(msg);
  } else {
    let msg = `⚠️ BACKGROUND RETRY COMPLETE: No executions recovered (${stillFailedArray.length}/${orgIds.length} orgs still failing)`;
    if (abandonedArray.length > 0) {
      msg += ` (${abandonedArray.length} abandoned)`;
    }
    this._log(msg);
  }

  // Store still-failed orgs in case we want another retry
  if (stillFailedArray.length > 0) {
    this._failedOrgIds = stillFailedArray;
  }

  // Store abandoned orgs separately - these are too slow to retry with normal methods
  if (abandonedArray.length > 0) {
    this._abandonedOrgs = abandonedArray;
    this._log(`📋 Abandoned orgs stored in _abandonedOrgs: ${abandonedArray.map(id => id.slice(0, 8)).join(', ')}`);
  }

  return retryResults.length > 0 ? retryResults : null;
}

/**
 * Internal: Fetch executions for a specific time chunk
 * NOW INCLUDES: conductor.input, organization, workflow.triggers for optimization
 * @param {number|null} daysAgoStart - Start of range (e.g., 0 for today)
 * @param {number|null} daysAgoEnd - End of range (e.g., 7 for 7 days ago)
 * @param {string|null} workflowId - Optional workflow ID filter
 * @param {Array<string>|null} orgIds - Optional array of org IDs
 * @returns {Promise<Array>} Array of executions for this chunk
 */
async _fetchExecutionsChunk(daysAgoStart, daysAgoEnd, workflowId, orgIds = null, options = {}) {
  // Single org - just run it
  if (!orgIds || orgIds.length <= 1) {
    return await this._fetchExecutionsChunkSingle(daysAgoStart, daysAgoEnd, workflowId, orgIds, options);
  }

  // Use sliding window for all orgs - batching (combining multiple orgs in one query) causes timeouts
  // because the server must gather ALL data before responding. Individual queries per org work better.
  const PRIORITY_ORG_COUNT = 3000;

  if (orgIds.length <= PRIORITY_ORG_COUNT) {
    // All orgs fit in priority window - use sliding window for all
    return await this._fetchExecutionsMultiOrgSliding(daysAgoStart, daysAgoEnd, workflowId, orgIds, options);
  }

  // Split: first 3000 sliding window, rest batched (unlikely to hit this)
  const priorityOrgs = orgIds.slice(0, PRIORITY_ORG_COUNT);
  const remainingOrgs = orgIds.slice(PRIORITY_ORG_COUNT);

  this._log(`🔀 Hybrid fetch: ${priorityOrgs.length} priority orgs (sliding) + ${remainingOrgs.length} remaining orgs (batched)`);

  // Priority orgs - sliding window, guaranteed complete
  const priorityResults = await this._fetchExecutionsMultiOrgSliding(daysAgoStart, daysAgoEnd, workflowId, priorityOrgs, options);

  // Remaining orgs - batched (can early return on timeout for huge counts)
  const remainingResults = await this._fetchExecutionsMultiOrg(daysAgoStart, daysAgoEnd, workflowId, remainingOrgs, options);

  return [...priorityResults, ...remainingResults];
}

/**
 * FAST PATH: Fetch executions for specific workflow IDs in parallel
 * Each workflow is fetched separately but all requests run concurrently.
 * Much faster than the chunked approach when you only need specific workflows.
 *
 * @param {string[]} workflowIds - Array of workflow IDs to fetch executions for
 * @param {number} daysBack - Number of days to look back
 * @param {string[]} orgIds - Org IDs to fetch for (uses parent org if null)
 * @param {object} options - timeout, includeTriggerInfo, includeRawContext, onProgress
 * @returns {Promise<Array>} - Combined executions from all workflows, flattened
 * @private
 */
/**
 * Fetch executions by chunking workflows - reuses existing adaptive day-chunking logic
 * Much faster than org-based chunking for specific workflow sets (e.g., forms)
 *
 * Strategy:
 * - Split workflows into chunks (default 10 per chunk, configurable via options.workflowChunkSize)
 * - Process chunks in parallel (default 6 concurrent, configurable via options.parallelChunks)
 * - Each chunk uses _fetchChunkAdaptive which handles: 6d → 3d → 2d → 1d → 0.5d → 0.25d → 0.1d
 * - Fetches ALL orgs in each request (not sliding by org)
 *
 * Example: 57 forms with chunk size 10
 * - Creates 6 chunks: [1-10], [11-20], [21-30], [31-40], [41-50], [51-57]
 * - Runs 6 chunks in parallel
 * - Each chunk adaptively breaks down time windows (covers full date range)
 * - Total: ~6-20 requests depending on data volume vs ~100+ with org chunking
 */
async _fetchExecutionsByWorkflowChunks(workflowIds, daysBack, orgIds, options = {}) {
  const { timeout = 45000, onProgress } = options;
  const targetOrgIds = orgIds || [this.orgId];

  // Configuration
  const WORKFLOW_CHUNK_SIZE = options.workflowChunkSize || 1;   // 1 workflow per request (fire them all in parallel)
  const PARALLEL_CHUNKS = options.parallelChunks || 20;          // Process 20 at a time (fast sliding window)

  // Use larger initial chunk sizes for workflow-based fetching (forms are typically less busy)
  // Start big, fail fast, adaptive fallback
  const WORKFLOW_DAY_CHUNKS = [30, 10, 6, 3, 1, 0.5];
  const WORKFLOW_DAY_TIMEOUTS = {
    30: 5000,   // 5s for 30-day chunks (fail FAST if too much data)
    10: 7000,   // 7s for 10-day chunks
    6: 10000,   // 10s for 6-day chunks
    3: 10000,   // 10s for 3-day chunks
    1: 10000,   // 10s for 1-day chunks
    0.5: 10000  // 10s for 0.5-day chunks
  };

  this._log(`🎯 Workflow-chunked fetch: ${workflowIds.length} workflow(s), ${daysBack} days, ${targetOrgIds.length} org(s)`);
  this._log(`   Chunk size: ${WORKFLOW_CHUNK_SIZE} workflows/request, ${PARALLEL_CHUNKS} parallel`);
  this._log(`   Day chunks: ${WORKFLOW_DAY_CHUNKS.join(', ')} days`);
  const startTime = Date.now();

  // Split workflows into chunks
  const workflowChunks = [];
  for (let i = 0; i < workflowIds.length; i += WORKFLOW_CHUNK_SIZE) {
    workflowChunks.push(workflowIds.slice(i, i + WORKFLOW_CHUNK_SIZE));
  }

  this._log(`   Created ${workflowChunks.length} workflow chunks`);

  // Process chunks with sliding window (parallel limit)
  const allResults = [];
  let completed = 0;

  for (let i = 0; i < workflowChunks.length; i += PARALLEL_CHUNKS) {
    const batch = workflowChunks.slice(i, i + PARALLEL_CHUNKS);

    this._log(`📦 Processing workflow chunk batch ${i / PARALLEL_CHUNKS + 1}/${Math.ceil(workflowChunks.length / PARALLEL_CHUNKS)} (${batch.length} chunks)`);

    // Process this batch in parallel - each workflow chunk tries adaptive day ranges with ALL orgs at once
    const batchPromises = batch.map(chunkWorkflowIds =>
      this._fetchWorkflowChunkWithAdaptiveDays(chunkWorkflowIds, daysBack, targetOrgIds, WORKFLOW_DAY_CHUNKS, WORKFLOW_DAY_TIMEOUTS)
    );

    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults.flat());

    completed += batch.length;
    if (onProgress) {
      const progress = Math.round((completed / workflowChunks.length) * 100);
      onProgress({ phase: 'batches', completed, total: workflowChunks.length, status: `${progress}%` });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  this._log(`✅ Workflow-chunked fetch complete: ${allResults.length} executions in ${elapsed}s`);

  // Enrich with trigger info if requested
  const { includeTriggerInfo, includeRawContext } = options;
  if (includeTriggerInfo && allResults.length > 0) {
    this._log(`Fetching trigger information for ${allResults.length} executions...`);
    await this._buildReferenceCache();
    const result = await this._fetchTriggerInfoBatched(allResults, includeRawContext, { timeout });
    return result.executions;
  }

  return allResults;
}

/**
 * Fetch a single workflow chunk with adaptive day ranges, ALL orgs at once (no sliding window)
 * Loops through time (30d → 14d → 6d...) and covers full date range
 */
async _fetchWorkflowChunkWithAdaptiveDays(workflowIds, maxDays, orgIds, dayChunks, dayTimeouts) {
  const allResults = [];
  let currentEnd = maxDays;  // Start from most recent
  let chunkIndex = 0;

  this._log(`   🎯 Fetching ${workflowIds.length} workflow(s), ${orgIds.length} org(s), ${maxDays} days max`);

  // Loop backwards through time (30 → 0), breaking into adaptive chunks
  while (currentEnd > 0 && chunkIndex < dayChunks.length) {
    const targetChunkSize = dayChunks[chunkIndex];
    const actualChunkSize = Math.min(targetChunkSize, currentEnd);
    const currentStart = Math.max(0, currentEnd - actualChunkSize);
    const timeoutMs = dayTimeouts[targetChunkSize] || 10000;

    this._log(`   📦 Trying days ${currentStart}-${currentEnd} (${targetChunkSize}d chunk, ${timeoutMs/1000}s timeout)...`);

    try {
      // Fetch ALL orgs at once - no sliding window!
      const executions = await this._fetchExecutionsChunkSingle(currentStart, currentEnd, null, orgIds, {
        timeout: timeoutMs,
        includeOnlyWorkflowIds: workflowIds
      });

      this._log(`   ✅ Success: ${executions.length} executions (days ${currentStart}-${currentEnd})`);
      allResults.push(...executions);

      // Move to next time window
      currentEnd = currentStart;
      // Keep same chunk size for next window (don't reset to 30d if 6d worked!)
      // chunkIndex stays the same

    } catch (error) {
      this._log(`   ⚠️ Failed (${targetChunkSize}d chunk): ${error.message}`);

      // Try smaller chunk size for THIS SAME TIME WINDOW
      if (chunkIndex < dayChunks.length - 1) {
        this._log(`   🔄 Retrying days ${currentStart}-${currentEnd} with smaller chunk...`);
        chunkIndex++;
        // Don't move currentEnd - retry the same window
      } else {
        this._log(`   ❌ All chunk sizes exhausted for days ${currentStart}-${currentEnd}, skipping`);
        // Skip this window and move on
        currentEnd = currentStart;
        chunkIndex = 0;
      }
    }
  }

  this._log(`   📊 Workflow chunk complete: ${allResults.length} executions`);
  return allResults;
}

/**
 * Internal: Fetch executions for a single chunk (≤ORG_BATCH_SIZE orgs)
 * @private
 */
async _fetchExecutionsChunkSingle(daysAgoStart, daysAgoEnd, workflowId, orgIds = null, options = {}) {
  // UPDATED QUERY: Now includes conductor.input, organization, and workflow.triggers
  const query = `
    query getWorkflowExecutions($where: WorkflowExecutionWhereInput!, $order: [[String!]!], $search: WorkflowExecutionSearchInput, $limit: Int) {
      workflowExecutions(
        where: $where
        order: $order
        search: $search
        limit: $limit
      ) {
        id
        status
        createdAt
        updatedAt
        numSuccessfulTasks
        parentExecutionId
        originatingExecutionId
        organization {
          id
          name
          managingOrgId
        }
        conductor {
          input
        }
        workflow {
          id
          orgId
          name
          type
          humanSecondsSaved
          triggers {
            id
            name
            formId
            triggerType {
              name
              ref
            }
          }
        }
      }
    }
  `;

  // Match original variable structure exactly
  // Use options.scope if provided, otherwise fall back to static RewstApp.WORKFLOW_SCOPE
  const scope = options.scope || RewstApp.WORKFLOW_SCOPE;
  const variables = {
    where: {},
    order: [["createdAt", "desc"]],
    search: {
      // Filter based on scope: 'parents' | 'subs' | 'both'
      ...(scope === 'parents' ? { originatingExecutionId: { _eq: null } } :
          scope === 'subs' ? { originatingExecutionId: { _ne: null } } : {})
    },
    limit: 10000
  };

  // Add org filter to search (not where) - matches original
  if (orgIds && orgIds.length > 0) {
    variables.search.orgId = { _in: orgIds };
  } else {
    variables.search.orgId = { _eq: this.orgId };
  }

  // Add date filters if specified - matches original
  if (daysAgoStart !== null && daysAgoEnd !== null) {
    const endDate = new Date(Date.now() - daysAgoStart * 24 * 60 * 60 * 1000).toISOString();
    const startDate = new Date(Date.now() - daysAgoEnd * 24 * 60 * 60 * 1000).toISOString();

    variables.search.createdAt = {
      _gt: startDate,
      _lt: endDate
    };
  }

  // Add workflow filter if specified - matches original
  if (workflowId) {
    variables.where.workflowId = workflowId;
  }

  // Add workflow exclusion filter if specified (for auto-exclude busy workflows feature)
  // Uses nested workflow search: search.workflow.id._nin
  if (options.excludeWorkflowIds && options.excludeWorkflowIds.length > 0) {
    variables.search.workflow = {
      id: { _nin: options.excludeWorkflowIds }
    };
    this._log(`Excluding ${options.excludeWorkflowIds.length} workflow(s) from fetch`);
  }

  // Add workflow inclusion filter if specified (for form-first loading)
  // Uses nested workflow search: search.workflow.id._in
  if (options.includeOnlyWorkflowIds && options.includeOnlyWorkflowIds.length > 0) {
    variables.search.workflow = {
      id: { _in: options.includeOnlyWorkflowIds }
    };
    this._log(`🎯 Filtering to ${options.includeOnlyWorkflowIds.length} workflow(s)`);
  }

  const result = await this._graphql('getWorkflowExecutions', query, variables, options);
  return result.workflowExecutions || [];
}

/**
 * Internal: Fetch executions with LIGHTWEIGHT query (for sub-workflows)
 * Excludes conductor.input and workflow.triggers to reduce data transfer by 80-90%
 * @private
 */
async _fetchExecutionsChunkSingleLightweight(daysAgoStart, daysAgoEnd, workflowId, orgIds = null, options = {}) {
  // LIGHTWEIGHT QUERY: Excludes conductor.input and workflow.triggers
  // Used for sub-workflow fetches to avoid massive data transfer (25-250GB of conductor.input + 2.5M-5M trigger objects)
  const query = `
    query getWorkflowExecutions($where: WorkflowExecutionWhereInput!, $order: [[String!]!], $search: WorkflowExecutionSearchInput, $limit: Int) {
      workflowExecutions(
        where: $where
        order: $order
        search: $search
        limit: $limit
      ) {
        id
        status
        createdAt
        updatedAt
        numSuccessfulTasks
        parentExecutionId
        originatingExecutionId
        organization {
          id
          name
          managingOrgId
        }
        workflow {
          id
          name
          humanSecondsSaved
        }
      }
    }
  `;

  // Match original variable structure exactly
  // Use options.scope if provided, otherwise fall back to static RewstApp.WORKFLOW_SCOPE
  const scope = options.scope || RewstApp.WORKFLOW_SCOPE;
  const variables = {
    where: {},
    order: [["createdAt", "desc"]],
    search: {
      // Filter based on scope: 'parents' | 'subs' | 'both'
      ...(scope === 'parents' ? { originatingExecutionId: { _eq: null } } :
          scope === 'subs' ? { originatingExecutionId: { _ne: null } } : {})
    },
    limit: 10000
  };

  // Add org filter to search (not where) - matches original
  if (orgIds && orgIds.length > 0) {
    variables.search.orgId = { _in: orgIds };
  } else {
    variables.search.orgId = { _eq: this.orgId };
  }

  // Add date filters if specified - matches original
  if (daysAgoStart !== null && daysAgoEnd !== null) {
    const endDate = new Date(Date.now() - daysAgoStart * 24 * 60 * 60 * 1000).toISOString();
    const startDate = new Date(Date.now() - daysAgoEnd * 24 * 60 * 60 * 1000).toISOString();

    variables.search.createdAt = {
      _gt: startDate,
      _lt: endDate
    };
  }

  // Add workflow filter if specified - matches original
  if (workflowId) {
    variables.where.workflowId = workflowId;
  }

  // Add workflow exclusion filter if specified (for auto-exclude busy workflows feature)
  // Uses nested workflow search: search.workflow.id._nin
  if (options.excludeWorkflowIds && options.excludeWorkflowIds.length > 0) {
    variables.search.workflow = {
      id: { _nin: options.excludeWorkflowIds }
    };
    this._log(`Excluding ${options.excludeWorkflowIds.length} workflow(s) from lightweight fetch`);
  }

  const result = await this._graphql('getWorkflowExecutions', query, variables, options);
  return result.workflowExecutions || [];
}

/**
 * Internal: Fetch executions with LIGHTWEIGHT query (routing method)
 * Routes to appropriate fetch method (sliding window, batching, or single query)
 * @private
 */
async _fetchExecutionsChunkLightweight(daysAgoStart, daysAgoEnd, workflowId, orgIds = null, options = {}) {
  // Single org - just run it
  if (!orgIds || orgIds.length <= 1) {
    return await this._fetchExecutionsChunkSingleLightweight(daysAgoStart, daysAgoEnd, workflowId, orgIds, options);
  }

  // Use sliding window for all orgs - batching (combining multiple orgs in one query) causes timeouts
  // because the server must gather ALL data before responding. Individual queries per org work better.
  const PRIORITY_ORG_COUNT = 3000;

  if (orgIds.length <= PRIORITY_ORG_COUNT) {
    // All orgs fit in priority window - use sliding window for all
    return await this._fetchExecutionsMultiOrgSlidingLightweight(daysAgoStart, daysAgoEnd, workflowId, orgIds, options);
  }

  // Split: first 3000 sliding window, rest batched (unlikely to hit this)
  const priorityOrgs = orgIds.slice(0, PRIORITY_ORG_COUNT);
  const remainingOrgs = orgIds.slice(PRIORITY_ORG_COUNT);

  this._log(`🔀 Hybrid fetch (lightweight): ${priorityOrgs.length} priority orgs (sliding) + ${remainingOrgs.length} remaining orgs (batched)`);

  // Priority orgs - sliding window, guaranteed complete
  const priorityResults = await this._fetchExecutionsMultiOrgSlidingLightweight(daysAgoStart, daysAgoEnd, workflowId, priorityOrgs, options);

  // Remaining orgs - batched (can early return on timeout for huge counts)
  const remainingResults = await this._fetchExecutionsMultiOrgLightweight(daysAgoStart, daysAgoEnd, workflowId, remainingOrgs, options);

  return [...priorityResults, ...remainingResults];
}

/**
 * Fetch executions with adaptive chunking using LIGHTWEIGHT query
 * Same logic as _fetchChunkAdaptive() but uses lightweight query
 * Supports options.deadline - if set, will bail out mid-loop and throw DeadlineError with partial results.
 * @private
 */
async _fetchChunkAdaptiveLightweight(startDay, endDay, chunkSizeIndex, workflowId, orgIds, allResults = [], options = {}) {
  const CHUNK_SIZES = RewstApp.CHUNK_SIZES;
  const CHUNK_TIMEOUTS = RewstApp.CHUNK_TIMEOUTS;
  // Use globalDeadline (from getRecentExecutions) if provided, else fall back to per-chunk deadline
  const { globalDeadline, deadline, deadlineFailedOrgs } = options;
  const effectiveDeadline = globalDeadline || deadline;

  // Process from endDay backwards to startDay
  let currentEnd = endDay;
  let currentChunkIndex = chunkSizeIndex;

  while (currentEnd > startDay) {
    // Check global deadline at start of each chunk iteration
    if (effectiveDeadline && Date.now() > effectiveDeadline) {
      this._log(`⏰ GLOBAL DEADLINE HIT inside _fetchChunkAdaptiveLightweight - returning ${allResults.length} partial results, remaining: days ${startDay}-${currentEnd}`);
      const deadlineError = new Error('DEADLINE_HIT');
      deadlineError.isDeadline = true;
      deadlineError.partialResults = allResults;
      deadlineError.remainingRange = { startDay, endDay: currentEnd, chunkSizeIndex: currentChunkIndex };
      throw deadlineError;
    }

    const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
    const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
    const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 10000;

    this._log(`[Lightweight] Fetching days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (${currentChunkSize}-day chunk, ${timeoutMs/1000}s timeout)...`);

    try {
      const fetchStart = Date.now();
      // Pass globalDeadline and deadlineFailedOrgs through to sliding window
      const chunkExecutions = await this._fetchExecutionsChunkLightweight(currentStart, currentEnd, workflowId, orgIds, {
        timeout: timeoutMs,
        ...options,
        globalDeadline: effectiveDeadline,
        deadlineFailedOrgs
      });
      const elapsed = Date.now() - fetchStart;

      if (elapsed > timeoutMs && currentChunkIndex < CHUNK_SIZES.length - 1) {
        // Took too long but succeeded - split for remaining chunks
        this._log(`⚠️ Lightweight chunk took ${elapsed}ms (>${timeoutMs}ms), reducing chunk size for remaining days`);
        currentChunkIndex++;
      }

      allResults.push(...chunkExecutions);
      this._log(`✓ Got ${chunkExecutions.length} executions (lightweight) in ${elapsed}ms`);
      currentEnd = currentStart;

    } catch (error) {
      // Check if it's a timeout/abort error OR our explicit retry signal
      const isTimeout = error.name === 'AbortError' || error.message?.includes('timed out');
      const isRetrySignal = error.message?.includes('will retry with smaller');

      this._log(`🔍 Lightweight chunk error: "${error.message}" (timeout: ${isTimeout}, retrySignal: ${isRetrySignal})`);

      if (currentChunkIndex < CHUNK_SIZES.length - 1) {
        // Try smaller chunk size for this same range
        const smallerSize = CHUNK_SIZES[currentChunkIndex + 1];
        this._log(`⚠️ Lightweight chunk failed, retrying days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} with ${smallerSize}-day chunks (was ${currentChunkSize}-day)...`);
        currentChunkIndex++;
        // Don't advance currentEnd - retry the same range with smaller chunks
      } else {
        // At minimum chunk size and still failing - log and skip this range
        const dateStart = new Date(Date.now() - currentEnd * 24 * 60 * 60 * 1000).toLocaleDateString();
        const dateEnd = new Date(Date.now() - currentStart * 24 * 60 * 60 * 1000).toLocaleDateString();
        this._error(`Failed to fetch ${dateStart} - ${dateEnd} even at minimum chunk size (0.1 day) with lightweight query. Skipping this range.`, error);
        currentEnd = currentStart; // Skip and move on
      }
    }

    // Small delay between chunks to be nice to the API
    if (currentEnd > startDay) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return allResults;
}

/**
 * SINGLE-ORG ONLY: Adaptive chunking for a single org with lightweight query (used by sliding window)
 * Calls _fetchExecutionsChunkSingleLightweight directly to avoid routing back to sliding window
 * @private
 */
async _fetchChunkAdaptiveSingleOrgLightweight(startDay, endDay, chunkSizeIndex, workflowId, orgId, allResults = [], options = {}) {
  const CHUNK_SIZES = RewstApp.CHUNK_SIZES;
  const CHUNK_TIMEOUTS = RewstApp.CHUNK_TIMEOUTS;
  const { deadline } = options;

  let currentEnd = endDay;
  let currentChunkIndex = chunkSizeIndex;

  while (currentEnd > startDay) {
    // Check deadline at start of each chunk iteration
    if (deadline && Date.now() > deadline) {
      this._log(`⏰ DEADLINE HIT for org ${orgId.slice(0, 8)} (lightweight) - returning ${allResults.length} partial results, remaining: days ${startDay}-${currentEnd}`);
      const deadlineError = new Error('DEADLINE_HIT');
      deadlineError.isDeadline = true;
      deadlineError.partialResults = allResults;
      deadlineError.remainingRange = { startDay, endDay: currentEnd, chunkSizeIndex: currentChunkIndex };
      throw deadlineError;
    }

    const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
    const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
    const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 10000;

    try {
      const fetchStart = Date.now();
      // Call single-org lightweight fetch directly (not _fetchExecutionsChunkLightweight which routes to sliding window)
      const chunkExecutions = await this._fetchExecutionsChunkSingleLightweight(currentStart, currentEnd, workflowId, [orgId], { timeout: timeoutMs, ...options });
      const elapsed = Date.now() - fetchStart;

      if (elapsed > timeoutMs && currentChunkIndex < CHUNK_SIZES.length - 1) {
        currentChunkIndex++;
      }

      allResults.push(...chunkExecutions);
      currentEnd = currentStart;

    } catch (error) {
      if (currentChunkIndex < CHUNK_SIZES.length - 1) {
        currentChunkIndex++;
      } else {
        this._error(`Failed to fetch org ${orgId.slice(0, 8)} (lightweight) at minimum chunk size. Skipping remaining days.`, error);
        currentEnd = startDay; // Skip remaining
      }
    }

    if (currentEnd > startDay) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return allResults;
}

  /**
   * Internal: Build reference data cache for triggers and forms
   * Creates lookup maps for efficient O(1) access
   */
  async _buildReferenceCache() {
    if (this._triggerCache && this._formCache) {
      this._log('Using cached reference data');
      return;
    }

    this._log('Building reference cache for triggers and forms...');

    try {
      // Fetch all workflows with their triggers
      const workflows = await this.getAllWorkflows();

      // Build trigger lookup map: triggerId -> { trigger data + workflowId + workflowName + workflowOrgId }
      this._triggerCache = new Map();
      workflows.forEach(workflow => {
        if (workflow.triggers) {
          workflow.triggers.forEach(trigger => {
            this._triggerCache.set(trigger.id, {
              ...trigger,
              workflowId: workflow.id,
              workflowName: workflow.name,
              workflowType: workflow.type,
              workflowOrgId: workflow.orgId
            });
          });
        }
      });

      // Fetch all forms
      const forms = await this.getAllForms();

      // Build form lookup map: formId -> form data
      this._formCache = new Map();
      forms.forEach(form => {
        this._formCache.set(form.id, form);
      });

      this._log(`Cached ${this._triggerCache.size} triggers and ${this._formCache.size} forms`);

    } catch (error) {
      this._error('Failed to build reference cache', error);
      // Don't throw - just continue without cache
    }
  }

  /**
   * Clear the reference data cache
   * Call this if you need to refresh trigger/form data
   */
  clearReferenceCache() {
    this._triggerCache = null;
    this._formCache = null;
    this._baseUrl = null;
    this._unsafeWorkflowIds = null;  // Clear the unsafe workflow cache too
    this._log('Reference cache cleared');
  }

  /**
   * Get Set of workflow IDs that have "unsafe" triggers (Form Submission or App Platform)
   * These workflows require conductor.input to properly detect trigger type
   * Cron Job, Webhook, and Integration triggers can be inferred without conductor.input
   * @private
   * @returns {Set<string>} Set of workflow IDs that need full query
   */
  _getUnsafeWorkflowIds() {
    // Return cached if available
    if (this._unsafeWorkflowIds) {
      return this._unsafeWorkflowIds;
    }

    // Build from trigger cache
    this._unsafeWorkflowIds = new Set();

    if (!this._triggerCache) {
      this._log('⚠️ _triggerCache not available - cannot identify unsafe workflows');
      return this._unsafeWorkflowIds;
    }

    // Scan all triggers to find workflows with Form Submission or App Platform triggers
    const UNSAFE_TRIGGER_TYPES = ['Form Submission', 'App Platform'];

    for (const [triggerId, trigger] of this._triggerCache) {
      const triggerTypeName = trigger.triggerType?.name || '';
      const triggerTypeRef = trigger.triggerType?.ref || '';

      // Check if this is an unsafe trigger type
      const isUnsafe = UNSAFE_TRIGGER_TYPES.some(type =>
        triggerTypeName.includes(type) || triggerTypeRef.includes(type.toLowerCase().replace(' ', '_'))
      );

      if (isUnsafe && trigger.workflowId) {
        this._unsafeWorkflowIds.add(trigger.workflowId);
      }
    }

    this._log(`📋 Identified ${this._unsafeWorkflowIds.size} 'unsafe' workflows (Form/App Platform triggers) out of ~${this._triggerCache.size} total triggers`);
    return this._unsafeWorkflowIds;
  }

/**
   * Check if workflow should skip context fetch based on name patterns
   * @private
   */
_shouldSkipContextFetch(workflow) {
  if (!this._skipContextWorkflows.length) return false;
  const name = workflow?.name || '';
  return this._skipContextWorkflows.some(pattern => name.includes(pattern));
}

 /**
   * Internal: Get base URL for links
   * Detects region from rew.st App Platform subdomain and returns correct app URL
   * Works both in iframe (ancestorOrigins) and standalone (location.origin)
   */
 _getBaseUrl() {
  if (this._baseUrl) return this._baseUrl;

  if (typeof window !== 'undefined') {
    // Check ancestor origins first (when running in iframe on App Platform)
    // Then fall back to current location origin
    const origin = window.location.ancestorOrigins?.[0] || window.location.origin;

    // Extract region from rew.st subdomain pattern: *.{region}.rew.st
    // Examples: pedroaviary-zipse-graphql-libs.asia.rew.st -> asia
    //           tlit60510-nick-strategist-example.rew.st -> (no region, US)
    //           pedroaviary-app-ops-analytics.eu.rew.st -> eu
    //           pedroaviary-zipse-test-apps.uk.rew.st -> uk
    const regionMatch = origin.match(/\.([a-z]+)\.rew\.st/i);

    if (regionMatch) {
      const region = regionMatch[1].toLowerCase();
      // Map region codes to app base URLs
      const regionMap = {
        'asia': 'https://app.rewst.asia',
        'uk': 'https://app.eu.rewst.io',    // UK uses EU app URL
        'eu': 'https://app.rewst.eu'
      };
      if (regionMap[region]) {
        this._baseUrl = regionMap[region];
        this._log('Detected region from rew.st subdomain:', region, '->', this._baseUrl);
        return this._baseUrl;
      }
    }

    // Check if it's rew.st without a region prefix (US)
    if (origin.includes('.rew.st')) {
      this._baseUrl = 'https://app.rewst.io';
      this._log('Detected US region (no subdomain prefix):', this._baseUrl);
      return this._baseUrl;
    }
  }

  return REWST_DEFAULTS.BASE_URL;
}

/**
 * Internal: Extract base URL from context layers (can override configured default)
 */
_extractBaseUrl(contextLayers) {
  for (const layer of contextLayers) {
    if (layer.rewst?.app_url) {
      this._baseUrl = layer.rewst.app_url;
      this._log('Extracted base URL from context:', this._baseUrl);
      return this._baseUrl;
    }
  }
  return this._getBaseUrl();
}

/**
 * Internal: Build workflow link
 */
_buildWorkflowLink(workflowId, orgId = null) {
  const org = orgId || this.orgId;
  if (!org || !workflowId) return null;
  return `${this._getBaseUrl()}/organizations/${org}/workflows/${workflowId}`;
}

/**
 * Internal: Build form link
 */
_buildFormLink(formId, orgId = null) {
  const org = orgId || this.orgId;
  if (!org || !formId) return null;
  return `${this._getBaseUrl()}/organizations/${org}/forms/${formId}`;
}

/**
 * Internal: Build execution link
 */
_buildExecutionLink(executionId, orgId = null) {
  const org = orgId || this.orgId;
  if (!org || !executionId) return null;
  return `${this._getBaseUrl()}/organizations/${org}/results/${executionId}`;
}
  /**
   * Find trigger name by type from workflow triggers array
   * @private
   */
  _findTriggerNameByType(triggers, typeName) {
    if (!triggers || !triggers.length) return 'Unknown';
    const match = triggers.find(t => t.triggerType?.name === typeName);
    return match?.name || 'Unknown';
  }

  /**
   * Find trigger ID by type from workflow triggers array
   * @private
   */
  _findTriggerIdByType(triggers, typeName) {
    if (!triggers || !triggers.length) return null;
    const match = triggers.find(t => t.triggerType?.name === typeName);
    return match?.id || null;
  }

  /**
   * Get trigger information for a specific execution
   * Shows what triggered the execution (Cron Job, Webhook, Manual/Test, Form Submission, etc.)
   * @param {string} executionId - The execution ID to lookup
   * @param {boolean} includeRawContext - Include raw context data (default: false)
   * @returns {Promise<object|null>} Trigger info object with type, typeRef, triggerName, formName, links, etc., or null
   */
  async getExecutionTriggerInfo(executionId, includeRawContext = false, options = {}) {
    if (!executionId) {
      const error = new Error('Execution ID is required');
      this._error('getExecutionTriggerInfo called without executionId', error);
      throw error;
    }

    this._log('Fetching trigger info for execution:', executionId);

    try {
      const query = `
        query getContexts($id: ID!) {
          contextLayers: workflowExecutionContexts(workflowExecutionId: $id)
        }
      `;

      const result = await this._graphql('getContexts', query, { id: executionId }, options);

      if (!result.contextLayers || result.contextLayers.length === 0) {
        this._log('No context layers found');
        return null;
      }

      // Extract base URL from context
      this._extractBaseUrl(result.contextLayers);

      // Build reference cache if not already built
      await this._buildReferenceCache();

      const triggerInfo = this._parseTriggerInfo(result.contextLayers, includeRawContext);

      // Enrich with form and workflow data from cache
      if (triggerInfo && triggerInfo.triggerId && this._triggerCache) {
        const cachedTrigger = this._triggerCache.get(triggerInfo.triggerId);

        if (cachedTrigger) {
          // Add form information if trigger has a formId - use workflow's orgId since form belongs to same org
          if (cachedTrigger.formId && this._formCache) {
            const form = this._formCache.get(cachedTrigger.formId);
            if (form) {
              triggerInfo.formId = cachedTrigger.formId;
              triggerInfo.formName = form.name;
              triggerInfo.formLink = this._buildFormLink(cachedTrigger.formId, cachedTrigger.workflowOrgId);
            }
          }

          // Add workflow link - use workflow's orgId
          if (cachedTrigger.workflowId) {
            triggerInfo.workflowLink = this._buildWorkflowLink(cachedTrigger.workflowId, cachedTrigger.workflowOrgId);
          }
        }
      }

      return triggerInfo;

    } catch (error) {
      this._error(`Failed to get trigger info for execution ${executionId}`, error);
      throw new Error(`Failed to get execution trigger info: ${error.message}`);
    }
  }

  /**
   * Get executions filtered by trigger type (e.g., "Cron Job", "Webhook", "Manual/Test")
   * Automatically includes trigger info for all returned executions
   * @param {string} triggerType - Trigger type to filter by (case-insensitive, partial match)
   * @param {number|null} daysBack - Number of days to look back, or null for all time (default: null)
   * @param {string|null} workflowId - Optional workflow ID to filter by (default: null)
   * @returns {Promise<Array>} Array of executions matching the trigger type
   */
  async getExecutionsByTriggerType(triggerType, daysBack = null, workflowId = null) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getExecutionsByTriggerType called before initialization', error);
      throw error;
    }

    this._log(`Fetching executions with trigger type: ${triggerType}`);

    try {
      const executions = await this.getRecentExecutions(true, daysBack, workflowId);

      const filtered = executions.filter(execution => {
        if (!execution.triggerInfo) return false;

        const execTriggerType = execution.triggerInfo.type?.toLowerCase();
        const searchType = triggerType.toLowerCase();

        return execTriggerType === searchType ||
               execution.triggerInfo.typeRef?.toLowerCase().includes(searchType);
      });

      this._log(`Found ${filtered.length} execution(s) matching trigger type "${triggerType}"`);
      return filtered;

    } catch (error) {
      this._error(`Failed to get executions by trigger type "${triggerType}"`, error);
      throw new Error(`Failed to get executions by trigger type: ${error.message}`);
    }
  }

  /**
   * Get all workflows in the current organization
   * Includes triggers, tags, and metadata
   * @returns {Promise<Array>} Array of workflow objects
   */
  async getAllWorkflows() {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getAllWorkflows called before initialization', error);
      throw error;
    }

    this._log('Fetching all workflows...');

    try {
      const query = `
        query getWorkflows($orgId: ID!, $where: WorkflowWhereInput, $order: [[String!]!], $limit: Int) {
          workflows(
            where: $where
            order: $order
            limit: $limit
          ) {
            id
            name
            description
            type
            createdAt
            updatedAt
            orgId
            triggers(where: {orgId: $orgId}) {
              id
              name
              enabled
              formId
              triggerType {
                name
                id
                ref
              }
            }
            tags {
              id
              name
              color
            }
            timeout
            humanSecondsSaved
          }
        }
      `;

      const result = await this._graphql('getWorkflows', query, {
        orgId: this.orgId,
        where: { orgId: this.orgId },
        order: [["updatedAt", "desc"]],
        limit: 1000
      });

      const workflows = result.workflows || [];

      // Add link to each workflow
      workflows.forEach(wf => {
        wf.link = this._buildWorkflowLink(wf.id, wf.orgId || this.orgId);
      });

      this._log(`Retrieved ${workflows.length} workflow(s)`);
      return workflows;

    } catch (error) {
      this._error('Failed to get workflows', error);
      throw new Error(`Failed to get workflows: ${error.message}`);
    }
  }

  /**
   * Get workflow stats aggregated by org (fast aggregate query)
   * Returns per-workflow execution counts, task counts, and time saved without fetching individual executions.
   * Use this to identify busy workflows before fetching detailed execution data.
   * @param {string} orgId - Organization ID
   * @param {string} startDate - Start date (ISO format)
   * @param {string} endDate - End date (ISO format)
   * @param {boolean} includeSubWorkflows - Include sub-workflow executions (default: false)
   * @returns {Promise<Array>} Array of workflow stats: { id, name, totalExecutions, totalTasks, numSucceededTasks, totalHumanSecondsSaved }
   */
  async getWorkflowStatsByOrg(orgId, startDate, endDate) {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getWorkflowStatsByOrg called before initialization', error);
      throw error;
    }

    this._log(`Fetching workflow stats for org ${orgId} from ${startDate} to ${endDate}...`);

    try {
      // Note: API uses startDate/endDate (not createdAtGte/createdAtLte)
      // Use inline values (not GraphQL variables) to match working manual query format
      const resolvedOrgId = orgId || this.orgId;
      const query = `
        query {
          workflowStatsByOrg(
            orgId: "${resolvedOrgId}"
            startDate: "${startDate}"
            endDate: "${endDate}"
          ) {
            id
            name
            numSucceededTasks
            totalTasks
            totalExecutions
            totalHumanSecondsSaved
          }
        }
      `;

      // Pass null as operationName since query is anonymous (no "query name { }")
      const result = await this._graphql(null, query, {});

      const stats = result.workflowStatsByOrg || [];
      this._log(`Retrieved stats for ${stats.length} workflow(s)`);
      return stats;

    } catch (error) {
      this._error('Failed to get workflow stats by org', error);
      throw new Error(`Failed to get workflow stats: ${error.message}`);
    }
  }

  /**
   * Get all forms in the current organization
   * Includes fields (sorted by index), field types, triggers, and conditions
   * @returns {Promise<Array>} Array of form objects with sorted fields and conditions
   */
  async getAllForms() {
    if (!this.isInitialized) {
      const error = new Error('Rewst not initialized. Call rewst.init() first!');
      this._error('getAllForms called before initialization', error);
      throw error;
    }

    this._log('Fetching all forms...');

    try {
      const query = `
        query getForms($orgId: ID!) {
          forms(where: {orgId: $orgId}) {
            id
            name
            description
            fields {
              id
              type
              schema
              index
              conditions {
                action
                actionValue
                fieldId
                sourceFieldId
                requiredValue
                index
                conditionType
                sourceField {
                  id
                  schema
                }
              }
            }
            triggers {
              id
              name
            }
          }
        }
      `;

      const result = await this._graphql('getForms', query, {
        orgId: this.orgId
      }, { timeout: 60000 }); // 60s timeout for forms

      const forms = result.forms || [];

      // Sort fields by index and add link for each form
      forms.forEach(form => {
        if (form.fields && form.fields.length > 0) {
          form.fields.sort((a, b) => (a.index || 0) - (b.index || 0));
        }
        form.link = this._buildFormLink(form.id);
      });

      this._log(`Retrieved ${forms.length} form(s)`);
      return forms;

    } catch (error) {
      this._error('Failed to get forms', error);
      // Return empty array instead of throwing - don't crash dashboard for forms
      this._log('⚠️ Forms unavailable, continuing without form data');
      return [];
    }
  }

  /**
   * Fetch form schemas for forms that have submissions but aren't in the forms cache.
   * This handles managed org forms - forms created in sub-orgs aren't returned by getAllForms().
   * Call this after initial load to get pretty field labels for managed org form analytics.
   * @param {Array} executions - Array of execution objects (from dashboardData.executions)
   * @param {Array} existingForms - Array of already-loaded forms (from dashboardData.forms)
   * @param {object} options - Options: maxForms (default 20), timeout (default 10000ms)
   * @returns {Promise<Array>} Array of newly fetched form objects
   */
  async fetchMissingForms(executions, existingForms = [], options = {}) {
    if (!this.isInitialized) {
      this._log('⚠️ fetchMissingForms: Not initialized');
      return [];
    }

    const maxForms = options.maxForms || 20;
    const timeoutMs = options.timeout || 10000;

    // Helper to get formId from execution (same logic as dashboard pages)
    const getFormId = (exec) => {
      if (exec.triggerInfo?.formId) return exec.triggerInfo.formId;
      if (exec.form?.id) return exec.form.id;
      if (exec.workflow?.triggers) {
        const formTrigger = exec.workflow.triggers.find(t =>
          t.triggerType?.name === 'Form Submission' || t.triggerType?.ref?.includes('form')
        );
        if (formTrigger?.formId) return formTrigger.formId;
      }
      return null;
    };

    // Find unique form IDs from executions
    const formIdsInExecutions = new Set();
    executions.forEach(exec => {
      const formId = getFormId(exec);
      if (formId) formIdsInExecutions.add(formId);
    });

    // Find which ones aren't in the existing forms cache
    const existingFormIds = new Set(existingForms.map(f => f.id));
    const missingFormIds = [...formIdsInExecutions].filter(id => !existingFormIds.has(id));

    if (missingFormIds.length === 0) {
      this._log('📋 No missing forms to fetch - all form schemas already cached');
      return [];
    }

    this._log(`📋 Found ${missingFormIds.length} form(s) with submissions but not in cache (managed org forms)`);

    // Limit to avoid too many requests
    const toFetch = missingFormIds.slice(0, maxForms);
    if (missingFormIds.length > maxForms) {
      this._log(`   ⚠️ Limiting to ${maxForms} forms (${missingFormIds.length - maxForms} skipped)`);
    }

    // Fetch each form individually (GraphQL doesn't support id_in for forms)
    const fetchedForms = [];
    const PARALLEL_LIMIT = 3;

    for (let i = 0; i < toFetch.length; i += PARALLEL_LIMIT) {
      const batch = toFetch.slice(i, i + PARALLEL_LIMIT);
      const promises = batch.map(async (formId) => {
        try {
          const form = await Promise.race([
            this._getForm(formId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
          ]);
          if (form) {
            this._log(`   ✅ Fetched form: ${form.name || formId.slice(0, 8)}`);
            return form;
          }
        } catch (err) {
          this._log(`   ❌ Failed to fetch form ${formId.slice(0, 8)}: ${err.message}`);
        }
        return null;
      });

      const results = await Promise.all(promises);
      fetchedForms.push(...results.filter(Boolean));
    }

    this._log(`📋 Fetched ${fetchedForms.length}/${toFetch.length} missing form schemas`);

    return fetchedForms;
  }

  /**
   * Get the status and details of a workflow execution
   * @param {string} executionId - The execution ID to lookup
   * @param {boolean} includeOutput - Include output variables, input, and errors (default: false)
   * @param {boolean} includeTriggerInfo - Include trigger type information (default: false)
   * @returns {Promise<object>} Execution details with optional output and triggerInfo
   */
  async getExecutionStatus(executionId, includeOutput = false, includeTriggerInfo = false) {
    if (!executionId) {
      const error = new Error('Execution ID is required');
      this._error('getExecutionStatus called without executionId', error);
      throw error;
    }

    this._log('Fetching execution status:', executionId);

    try {
      const query = includeOutput ? `
        query getExecutionWithOutput($orgId: ID!, $id: ID!) {
          workflowExecution(where: {orgId: $orgId, id: $id}) {
            id
            status
            createdAt
            updatedAt
            numSuccessfulTasks
            conductor {
              output
              input
              errors
            }
            workflow {
              id
              name
            }
          }
          taskLogs(where: {workflowExecutionId: $id}) {
            id
            status
            message
            result
            executionTime
            workflowTaskName: originalWorkflowTaskName
          }
        }
      ` : `
        query getExecution($orgId: ID!, $id: ID!) {
          workflowExecution(where: {orgId: $orgId, id: $id}) {
            id
            status
            createdAt
            updatedAt
            numSuccessfulTasks
            workflow {
              id
              name
            }
          }
          taskLogs(where: {workflowExecutionId: $id}) {
            id
            status
            message
            result
            executionTime
            workflowTaskName: originalWorkflowTaskName
          }
        }
      `;

      const result = await this._graphql(
        includeOutput ? 'getExecutionWithOutput' : 'getExecution',
        query,
        { id: executionId, orgId: this.orgId }
      );

      if (!result.workflowExecution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      this._log('Execution status:', result.workflowExecution.status);

      const response = {
        execution: result.workflowExecution,
        taskLogs: result.taskLogs || []
      };

      if (includeOutput && result.workflowExecution.conductor) {
        response.output = result.workflowExecution.conductor.output || {};
        response.input = result.workflowExecution.conductor.input || {};
        response.errors = result.workflowExecution.conductor.errors || [];
      }

      if (includeTriggerInfo) {
        try {
          response.triggerInfo = await this.getExecutionTriggerInfo(executionId);
        } catch (error) {
          this._log('Failed to get trigger info:', error.message);
          response.triggerInfo = null;
        }
      }

      return response;

    } catch (error) {
      this._error(`Failed to get execution status for ${executionId}`, error);
      throw new Error(`Failed to get execution status: ${error.message}`);
    }
  }

  /**
   * Get the input/output schema (I/O configuration) for a workflow
   * Shows expected input parameters and output variables
   * @param {string} workflowId - The workflow ID to lookup
   * @returns {Promise<object|null>} Schema object with id, name, input, output, or null if not found
   */
  async getWorkflowSchema(workflowId) {
    if (!workflowId) {
      const error = new Error('Workflow ID is required');
      this._error('getWorkflowSchema called without workflowId', error);
      throw error;
    }

    this._log('Fetching workflow schema:', workflowId);

    try {
      const query = `
        query getWorkflowContextOptions($ids: [ID!]!) {
          workflowIOConfigurations(ids: $ids) {
            id
            name
            input
            output
          }
        }
      `;

      const result = await this._graphql('getWorkflowContextOptions', query, {
        ids: [workflowId]
      });

      const schema = result.workflowIOConfigurations?.[0] || null;

      if (schema) {
        this._log('Retrieved workflow schema for:', schema.name);
      } else {
        this._log('No schema found for workflow:', workflowId);
      }

      return schema;

    } catch (error) {
      this._error(`Failed to get workflow schema for ${workflowId}`, error);
      throw new Error(`Failed to get workflow schema: ${error.message}`);
    }
  }

  /**
   * Parse trigger info from context layers and extract metadata such as user, form inputs, and organization.
   * @private
   * @param {Array<Object>} contextLayers - Workflow execution context layers.
   * @param {boolean} [includeRawContext=false] - Whether to include raw context data in the result.
   * @returns {Object|null} Parsed trigger information or null if none found.
   */
  _parseTriggerInfo(contextLayers, includeRawContext = false) {
    try {
      // Extract user info
      let user = null;
      for (const layer of contextLayers) {
        if (layer.user) {
          user = {
            id: layer.user.id || null,
            username: layer.user.username || null,
            email: layer.user.email || null,
            firstName: layer.user.first_name || null,
            lastName: layer.user.last_name || null
          };
          break;
        }
      }

      for (const layer of contextLayers) {
        // Trigger Execution (test/UI runs)
        if (layer.trigger_execution) {
          const t = layer.trigger_execution;
          const result = {
            type: t?.trigger_type?.name || 'Unknown',
            typeRef: t?.trigger_type?.ref || null,
            triggerName: layer.trigger_instance?.trigger?.name || 'Unknown',
            triggerId: t.trigger_id || null,
            triggerInstanceId: t.trigger_instance_id || null,
            triggeredAt: t.dispatched_at || null,
            isTest: t.is_test_execution || false,
            mode: t.mode || null,
            source: t.source || null,
            user
          };
          if (includeRawContext) result.rawContext = layer;
          if ((result.type || '').toLowerCase() === 'form submission')
            result.submittedInputs = this._extractSubmittedInputs(layer);
          if (layer.organization)
            result.organization = {
              id: layer.organization.id || null,
              name: layer.organization.name || null,
              domain: layer.organization.domain || null,
              managingOrgId: layer.organization.managing_org_id || null,
              rocSiteId: layer.organization.roc_site_id || null,
              isEnabled: layer.organization.is_enabled ?? null
            };
          return result;
        }

        // Trigger Instance (normal triggers)
        if (layer.trigger_instance) {
          const ti = layer.trigger_instance;
          const trig = ti.trigger;
          const tt = trig?.trigger_type;

          if (trig?.id && tt) {
            const result = {
              type: tt?.name || 'Unknown',
              typeRef: tt?.ref || null,
              triggerName: trig?.name || 'Unknown',
              triggerId: trig?.id || null,
              triggerInstanceId: ti?.id || null,
              triggeredAt: null,
              isTest: false,
              mode: null,
              source: null,
              user
            };
            if (includeRawContext) result.rawContext = layer;
            if ((result.type || '').toLowerCase() === 'form submission')
              result.submittedInputs = this._extractSubmittedInputs(layer);
            if (layer.organization)
              result.organization = {
                id: layer.organization.id || null,
                name: layer.organization.name || null,
                domain: layer.organization.domain || null,
                managingOrgId: layer.organization.managing_org_id || null,
                rocSiteId: layer.organization.roc_site_id || null,
                isEnabled: layer.organization.is_enabled ?? null
              };
            return result;
          }

          // App Platform (no trigger, app-builder user)
          if (!trig?.id && layer.user?.username?.toLowerCase()?.includes('app-builder')) {
            const result = {
              type: 'App Platform',
              typeRef: 'core.App Platform',
              triggerName: 'App Platform Execution',
              triggerId: null,
              triggerInstanceId: null,
              triggeredAt: null,
              isTest: false,
              mode: 'app_platform',
              source: 'app_builder',
              user
            };
            if (includeRawContext) result.rawContext = layer;
            if (layer.organization)
              result.organization = {
                id: layer.organization.id || null,
                name: layer.organization.name || null,
                domain: layer.organization.domain || null,
                managingOrgId: layer.organization.managing_org_id || null,
                rocSiteId: layer.organization.roc_site_id || null,
                isEnabled: layer.organization.is_enabled ?? null
              };
            return result;
          }
        }
      }

      // Manual/Test fallback
      const result = {
        type: 'Manual/Test',
        typeRef: null,
        triggerName: 'Manual Execution',
        triggerId: null,
        triggerInstanceId: null,
        triggeredAt: null,
        isTest: true,
        mode: 'manual',
        source: 'unknown',
        user
      };
      if (includeRawContext) result.rawContext = contextLayers[0];
      if (contextLayers[0]?.organization)
        result.organization = {
          id: contextLayers[0].organization.id || null,
          name: contextLayers[0].organization.name || null,
          domain: contextLayers[0].organization.domain || null,
          managingOrgId: contextLayers[0].organization.managing_org_id || null,
          rocSiteId: contextLayers[0].organization.roc_site_id || null,
          isEnabled: contextLayers[0].organization.is_enabled ?? null
        };
      return result;
    } catch (error) {
      this._log('Error parsing trigger info:', error.message);
      return null;
    }
  }

/**
 * Internal: Enrich executions with trigger info using OPTIMIZED approach
 * - Uses conductor.input pattern matching for Cron/Webhook/App Platform (NO context fetch)
 * - Only fetches full context for Form Submission and Manual/Test executions
 * @private
 * @param {Array} executions - List of execution objects to enrich
 * @param {boolean} includeRawContext - Whether to include raw context in trigger info
 * @param {object} options - Options including timeout
 * @returns {Promise<{executions: Array, failedIds: Array}>} - Enriched execution list and failed IDs for retry
 */
async _fetchTriggerInfoBatched(executions, includeRawContext = false, options = {}) {
  const results = [];
  const failedIds = []; // Track failed execution IDs for retry
  const needsContextFetch = []; // Executions that need full context

  this._log(`Processing ${executions.length} executions with optimized trigger detection...`);

  // PHASE 1: Pattern match what we can from conductor.input
  for (const execution of executions) {
    const conductorInput = execution.conductor?.input || {};
    const inferred = this._inferTriggerTypeFromInput(conductorInput);
    
    // Build links - use workflow's orgId (where it lives), fallback to execution's org
    const workflowLink = this._buildWorkflowLink(execution.workflow?.id, execution.workflow?.orgId || execution.organization?.id);
    const executionLink = this._buildExecutionLink(execution.id, execution.organization?.id);
    
    // Get organization from execution (already fetched!)
    const organization = execution.organization ? {
      id: execution.organization.id || null,
      name: execution.organization.name || null,
      managingOrgId: execution.organization.managingOrgId || null
    } : null;

    // Sub-workflow detection
    const isSubWorkflow = !!execution.parentExecutionId;

    if (inferred) {
      // SUCCESS: We inferred the trigger type without context fetch!
      const triggerInfo = {
        type: inferred.type,
        typeRef: inferred.typeRef,
        triggerName: this._findTriggerNameByType(execution.workflow?.triggers, inferred.type),
        triggerId: this._findTriggerIdByType(execution.workflow?.triggers, inferred.type),
        triggerInstanceId: null,
        triggeredAt: conductorInput.triggered_at || null,
        isTest: false,
        mode: inferred.type === 'App Platform' ? 'app_platform' : null,
        source: inferred.inferredFrom,
        user: null, // Not available without context
        organization,
        isSubWorkflow
      };

      results.push({
        ...execution,
        link: executionLink,
        workflow: { ...execution.workflow, link: workflowLink },
        triggerInfo,
        user: null,
        form: null,
        organization,
        tasksUsed: execution.numSuccessfulTasks || 0,
        totalTasks: execution.totalTasks || 0,
        humanSecondsSaved: execution.workflow?.humanSecondsSaved || 0,
        isSubWorkflow
      });
      
    } else if (isSubWorkflow) {
      // Sub-workflow without clear trigger pattern - mark as sub-workflow
      const triggerInfo = {
        type: 'Sub-workflow',
        typeRef: null,
        triggerName: 'Called from parent workflow',
        triggerId: null,
        triggerInstanceId: null,
        triggeredAt: null,
        isTest: false,
        mode: 'sub_workflow',
        source: 'parent_execution',
        user: null,
        organization,
        isSubWorkflow: true,
        parentExecutionId: execution.parentExecutionId
      };

      results.push({
        ...execution,
        link: executionLink,
        workflow: { ...execution.workflow, link: workflowLink },
        triggerInfo,
        user: null,
        form: null,
        organization,
        tasksUsed: execution.numSuccessfulTasks || 0,
        totalTasks: execution.totalTasks || 0,
        humanSecondsSaved: execution.workflow?.humanSecondsSaved || 0,
        isSubWorkflow: true
      });
      
    }  else if (this._shouldSkipContextFetch(execution.workflow)) {
      // Configured to skip context fetch for this workflow
      results.push({
        ...execution,
        link: executionLink,
        workflow: { ...execution.workflow, link: workflowLink },
        triggerInfo: {
          type: '(Skipped)',
          typeRef: null,
          triggerName: 'Context fetch skipped',
          triggerId: null,
          triggerInstanceId: null,
          triggeredAt: null,
          isTest: false,
          mode: 'skipped',
          source: 'skip_config',
          user: null,
          organization,
          isSubWorkflow
        },
        user: null,
        form: null,
        organization,
        tasksUsed: execution.numSuccessfulTasks || 0,
        totalTasks: execution.totalTasks || 0,
        humanSecondsSaved: execution.workflow?.humanSecondsSaved || 0,
        isSubWorkflow
      });
      
    } else {
      // Can't infer - need to fetch context (likely Form Submission or Manual/Test)
      needsContextFetch.push({
        execution,
        workflowLink,
        executionLink,
        organization
      });
    }
  }

  const inferredCount = results.length;
  this._log(`✅ Inferred trigger type for ${inferredCount}/${executions.length} executions (no context fetch needed)`);

  // PHASE 2: Fetch context only for executions that need it
  if (needsContextFetch.length > 0) {
    this._log(`📥 Fetching context for ${needsContextFetch.length} executions (Form/Manual/Unknown)...`);
    
    const batchSize = 25;
    const delayMs = 100;

    for (let i = 0; i < needsContextFetch.length; i += batchSize) {
      const batch = needsContextFetch.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async ({ execution, workflowLink, executionLink, organization }) => {
          try {
            const triggerInfo = await this.getExecutionTriggerInfo(execution.id, includeRawContext, options);
            
            if (!triggerInfo) {
              // Fallback to Manual/Test if no trigger info found
              return {
                ...execution,
                link: executionLink,
                workflow: { ...execution.workflow, link: workflowLink },
                triggerInfo: {
                  type: 'Manual/Test',
                  typeRef: null,
                  triggerName: 'Manual Execution',
                  triggerId: null,
                  isTest: true,
                  mode: 'manual',
                  source: 'unknown',
                  user: null,
                  organization
                },
                user: null,
                form: null,
                organization,
                tasksUsed: execution.numSuccessfulTasks || 0,
                totalTasks: execution.totalTasks || 0,
                humanSecondsSaved: execution.workflow?.humanSecondsSaved || 0
              };
            }

            // Extract user and form from context
            const user = triggerInfo.user || null;
            const form = triggerInfo.formId ? {
              id: triggerInfo.formId,
              name: triggerInfo.formName || null,
              link: triggerInfo.formLink || null,
              input: triggerInfo.submittedInputs || null // Include submitted inputs for form analytics
            } : null;

            // Use organization from context if available, otherwise from execution
            const orgFromContext = triggerInfo.organization || organization;

            return {
              ...execution,
              link: executionLink,
              workflow: { ...execution.workflow, link: workflowLink },
              triggerInfo,
              user,
              form,
              organization: orgFromContext,
              tasksUsed: execution.numSuccessfulTasks || 0,
              totalTasks: execution.totalTasks || 0,
              humanSecondsSaved: execution.workflow?.humanSecondsSaved || 0
            };

          } catch (error) {
            this._log(`⚠️ Failed to get context for ${execution.id}: ${error.message}`);
            failedIds.push(execution.id); // Track for retry later

            return {
              ...execution,
              link: executionLink,
              workflow: { ...execution.workflow, link: workflowLink },
              triggerInfo: null,
              user: null,
              form: null,
              organization,
              tasksUsed: execution.numSuccessfulTasks || 0,
              totalTasks: execution.totalTasks || 0,
              humanSecondsSaved: execution.workflow?.humanSecondsSaved || 0,
              error: error.message,
              _needsRetry: true // Flag for UI to know this can be retried
            };
          }
        })
      );

      results.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < needsContextFetch.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  const successCount = results.filter(r => r.triggerInfo !== null).length;
  this._log(`✅ Successfully processed ${successCount}/${executions.length} executions`);
  this._log(`   - Inferred (no context): ${inferredCount}`);
  this._log(`   - From context: ${needsContextFetch.length}`);
  if (failedIds.length > 0) {
    this._log(`   - ⚠️ Failed (will retry): ${failedIds.length}`);
  }

  return { executions: results, failedIds };
}

  /**
   * Internal: Get trigger information including workflow ID
   */
  async _getTriggerInfo(triggerId) {
    const query = `
      query getTrigger($id: ID!) {
        trigger(where: {id: $id}) {
          id
          name
          workflowId
          enabled
        }
      }
    `;

    try {
      const result = await this._graphql('getTrigger', query, { id: triggerId });
      return result.trigger;
    } catch (error) {
      this._error('Failed to get trigger info', error);
      throw error;
    }
  }

  /**
   * Internal: Find the most recent execution for a workflow/trigger combo
   * Looks for executions created in the last 30 seconds
   */
  async _findRecentExecution(workflowId, triggerId) {
    const maxAttempts = 10;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const query = `
          query getWorkflowExecutions($where: WorkflowExecutionWhereInput!, $order: [[String!]!], $search: WorkflowExecutionSearchInput, $limit: Int) {
            workflowExecutions(
              where: $where
              order: $order
              search: $search
              limit: $limit
            ) {
              id
              createdAt
            }
          }
        `;

        // Look for executions created in the last 30 seconds
        const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();

        const result = await this._graphql('getWorkflowExecutions', query, {
          where: {
            orgId: this.orgId,
            workflowId: workflowId
          },
          order: [["createdAt", "desc"]],
          search: {
            createdAt: { _gt: thirtySecondsAgo }
          },
          limit: 5
        });

        const executions = result.workflowExecutions || [];

        if (executions.length > 0) {
          // Return the most recent one
          this._log(`Found ${executions.length} recent execution(s), using most recent`);
          return executions[0].id;
        }

        // If no executions found yet, wait and retry
        if (attempt < maxAttempts - 1) {
          this._log(`No execution found yet (attempt ${attempt + 1}/${maxAttempts}), retrying...`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

      } catch (error) {
        this._error('Error finding recent execution', error);
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    this._log('Could not find execution after max attempts');
    return null;
  }

  async _graphql(operationName, query, variables = {}, options = {}) {
    const timeoutMs = options.timeout || 30000; // Default 30s for workflow operations
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ operationName, query, variables }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to get the actual error body for debugging
        let errorBody = '';
        try {
          errorBody = await response.text();
          console.error('[Rewst Debug] HTTP Error Response Body:', errorBody);
        } catch (e) { /* ignore */ }
        throw new Error(`Request failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        const errorStr = JSON.stringify(result.errors);

        // Check for auth errors - reload page to trigger platform's login redirect
        // Only match the specific AUTH_ERR code from Rewst API to avoid false positives
        const isAuthError = errorStr.includes('"code":"AUTH_ERR"');

        if (isAuthError) {
          this._log('🔒 Session expired');
          // Don't auto-reload - causes infinite loops in iframes
          // Throw a clear error that the UI can catch and display with login link
          const sessionError = new Error('SESSION_EXPIRED');
          sessionError.isSessionExpired = true;
          // Build login URL with returnTo param for current page
          // Try to get current path from parent window, fall back to just /s/login
          let currentPath = '/s/';
          try {
            if (window.parent && window.parent !== window) {
              currentPath = window.parent.location.pathname;
            }
          } catch (e) {
            // Cross-origin, can't access parent path
          }
          sessionError.loginUrl = `/s/login?returnTo=${encodeURIComponent(currentPath)}`;
          throw sessionError;
        }

        throw new Error(`GraphQL error: ${errorStr}`);
      }

      return result.data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        this._log(`⏱️ ${operationName} timed out after ${timeoutMs/1000}s`);
        throw new Error(`Request timed out after ${timeoutMs/1000}s: ${operationName}`);
      }
      throw error;
    }
  }

  async _getCurrentOrganization() {
    const query = `query getUserOrganization { userOrganization { id } }`;
    const result = await this._graphql('getUserOrganization', query);
    return result.userOrganization;
  }

  async _executeSimple(workflowId, input) {
    const query = `
      mutation testWorkflow($id: ID!, $orgId: ID!, $input: JSON) {
        testResult: testWorkflow(id: $id, orgId: $orgId, input: $input) {
          executionId
          __typename
        }
      }
    `;

    const result = await this._graphql('testWorkflow', query, {
      id: workflowId,
      orgId: this.orgId,
      input
    });

    return result.testResult;
  }

  async _executeWithTrigger(triggerInstanceId, triggerId, input) {
    const query = `
      mutation testTrigger($input: JSON, $triggerInstance: OrgTriggerInstanceInput!) {
        testResult: testWorkflowTrigger(triggerInstance: $triggerInstance, input: $input) {
          executionId
        }
      }
    `;

    const result = await this._graphql('testTrigger', query, {
      input,
      triggerInstance: {
        id: triggerInstanceId,
        orgId: this.orgId,
        isManualActivation: true,
        organization: { id: this.orgId, name: 'Current Org' },
        trigger: { id: triggerId, vars: [], orgId: this.orgId }
      }
    });

    return result.testResult;
  }

  async _getForm(formId) {
    const query = `
      query getForm($id: ID!, $orgContextId: ID) {
        form(where: {id: $id}, orgContextId: $orgContextId) {
          id
          name
          description
          fields {
            id
            type
            schema
            index
            conditions {
              action
              actionValue
              fieldId
              sourceFieldId
              requiredValue
              index
              conditionType
              sourceField {
                id
                schema
              }
            }
          }
          triggers {
            id
            name
          }
        }
      }
    `;

    const result = await this._graphql('getForm', query, {
      id: formId,
      orgContextId: this.orgId
    });

    const form = result.form;

    // Sort fields by index
    if (form && form.fields && form.fields.length > 0) {
      form.fields.sort((a, b) => (a.index || 0) - (b.index || 0));
    }

    return form;
  }

  async _waitForCompletion(executionId, onProgress = null) {
    const pollInterval = 2000;
    const maxAttempts = 150;
    let attempts = 0;
    let notFoundRetries = 0;
    const maxNotFoundRetries = 5;

    await new Promise(resolve => setTimeout(resolve, 500));

    while (attempts < maxAttempts) {
      try {
        const status = await this.getExecutionStatus(executionId, false);
        const execution = status.execution;
        notFoundRetries = 0;

        if (onProgress) {
          try {
            onProgress(execution.status, execution.numSuccessfulTasks);
          } catch (progressError) {
          }
        }

        const terminalStates = ['COMPLETED', 'SUCCESS', 'succeeded', 'FAILED', 'failed', 'ERROR'];
        const isComplete = terminalStates.some(s => execution.status.toUpperCase() === s.toUpperCase());

        if (isComplete) {
          const isFailed = ['FAILED', 'failed', 'ERROR'].some(s => execution.status.toUpperCase() === s.toUpperCase());
          if (isFailed) {
            throw new Error(`Workflow failed: ${execution.status}`);
          }
          const finalResult = await this.getExecutionStatus(executionId, true, true);
          return { ...finalResult, success: true };
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
      } catch (error) {
        if (error.message.includes('not found') && notFoundRetries < maxNotFoundRetries) {
          notFoundRetries++;
          this._log(`Execution not found yet, retry ${notFoundRetries}/${maxNotFoundRetries}...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        throw error;
      }
    }

    throw new Error('Workflow timeout (5 minutes)');
  }

  /**
   * Extract submitted form inputs from rawContext (excluding system/meta keys)
   * @private
   * @param {Object} rawContext - The raw context object from a form submission
   * @returns {Object|null} - Key/value object of submitted inputs
   */
  _extractSubmittedInputs(rawContext) {
    if (!rawContext || typeof rawContext !== 'object') return null;

    const systemKeys = [
      'organization', 'user', 'sentry_trace', 'execution_id',
      'originating_execution_id', 'rewst', 'trigger_instance',
      'trigger_execution', 'trigger_id', 'state', 'created_at', 'updated_at',
      'is_manual_activation', 'next_fire_time', 'tag_id', 'form_id'
    ];

    // Check if inputs are nested in a 'form_data' or similar key
    let sourceObj = rawContext;
    if (rawContext.form_data && typeof rawContext.form_data === 'object') {
      sourceObj = rawContext.form_data;
      this._log('📝 Found form inputs in form_data key');
    } else if (rawContext.submitted_inputs && typeof rawContext.submitted_inputs === 'object') {
      sourceObj = rawContext.submitted_inputs;
      this._log('📝 Found form inputs in submitted_inputs key');
    } else if (rawContext.inputs && typeof rawContext.inputs === 'object') {
      sourceObj = rawContext.inputs;
      this._log('📝 Found form inputs in inputs key');
    }

    const inputs = {};
    for (const [key, value] of Object.entries(sourceObj)) {
      if (!systemKeys.includes(key)) inputs[key] = value;
    }

    const inputCount = Object.keys(inputs).length;
    if (inputCount > 0) {
      this._log(`📝 Extracted ${inputCount} form input(s): ${Object.keys(inputs).slice(0, 5).join(', ')}${inputCount > 5 ? '...' : ''}`);
    }

    return inputCount > 0 ? inputs : null;
  }

}

if (typeof window !== 'undefined') {
  window.RewstApp = RewstApp;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RewstApp;
}