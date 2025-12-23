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
 * Run a Workflow:
 *   // Basic - run workflow and get result
 *   const result = await rewst.runWorkflowSmart('workflow-id');
 *   console.log(result.output);           // Output variables from the workflow
 *   console.log(result.success);          // true if completed successfully
 *
 *   // With input data - pass variables to the workflow
 *   const result = await rewst.runWorkflowSmart('workflow-id', {
 *     userName: 'John',
 *     ticketId: 12345,
 *     priority: 'high'
 *   });
 *   console.log(result.output);           // Access workflow output variables
 *
 *   // With progress tracking - monitor execution status
 *   const result = await rewst.runWorkflowSmart('workflow-id', { input: 'data' }, {
 *     onProgress: (status, tasksComplete) => {
 *       console.log(`Status: ${status}, Tasks completed: ${tasksComplete}`);
 *     }
 *   });
 *
 *   // Access the full result object
 *   console.log(result.output);           // Output variables
 *   console.log(result.success);          // Boolean - did it complete successfully?
 *   console.log(result.executionId);      // The execution ID
 *   console.log(result.triggerInfo.type); // How it was triggered (Cron Job, Webhook, etc.)
 *
 * Get Last Workflow Execution:
 *   // Get the most recent execution of a specific workflow
 *   const lastRun = await rewst.getLastWorkflowExecution('workflow-id');
 *   console.log('Output:', lastRun.output);
 *   console.log('Status:', lastRun.status);
 *   console.log('Trigger:', lastRun.triggerInfo.type);
 *   console.log('Completed:', lastRun.completedAt);
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
      throw new Error(`Failed to get organization variables: ${error.message}`);
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

      this._log(`Retrieved ${allOrgs.length} total organization(s) (1 target + ${managedOrgs.length} managed)`);
      return allOrgs;

    } catch (error) {
      this._error('Failed to get managed organizations', error);
      throw new Error(`Failed to get managed organizations: ${error.message}`);
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
  // Progressive TIMEOUTS - parallel org batching allows longer timeouts without blocking
  static CHUNK_TIMEOUTS = {
    6: 10000,    // 10 seconds for 6-day chunks
    3: 10000,    // 10 seconds for 3-day chunks
    2: 10000,    // 10 seconds for 2-day chunks
    1: 10000,    // 10 seconds for 1-day chunks
    0.5: 55000,  // 55 seconds for 0.5-day chunks (12 hours) - org batches run in parallel
    0.25: 55000, // 55 seconds for 0.25-day chunks (6 hours)
    0.1: 55000   // 55 seconds for 0.1-day chunks (~2.4 hours)
  };
  // RETRY-SPECIFIC: More aggressive limits - stop at 3 days, shorter timeouts
  static RETRY_CHUNK_SIZES = [6, 3];  // Stop at 3 days - if that fails, give up (faster abandonment)
  static RETRY_CHUNK_TIMEOUTS = {
    6: 10000,    // 10 seconds for 6-day chunks
    3: 20000     // 20 seconds for 3-day chunks (max - then abandon)
  };

  /**
   * Fetch executions for a date range with adaptive chunk sizing.
   * Starts with larger chunks and automatically splits on timeout.
   * @private
   */
  async _fetchChunkAdaptive(startDay, endDay, chunkSizeIndex, workflowId, orgIds, allResults = []) {
    const CHUNK_SIZES = RewstApp.CHUNK_SIZES;
    const CHUNK_TIMEOUTS = RewstApp.CHUNK_TIMEOUTS;

    // Process from endDay backwards to startDay
    let currentEnd = endDay;
    let currentChunkIndex = chunkSizeIndex;

    while (currentEnd > startDay) {
      const currentChunkSize = CHUNK_SIZES[currentChunkIndex];
      const currentStart = Math.max(startDay, currentEnd - currentChunkSize);
      const timeoutMs = CHUNK_TIMEOUTS[currentChunkSize] || 10000;

      this._log(`Fetching days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} (${currentChunkSize}-day chunk, ${timeoutMs/1000}s timeout)...`);

      try {
        const fetchStart = Date.now();
        const chunkExecutions = await this._fetchExecutionsChunk(currentStart, currentEnd, workflowId, orgIds, { timeout: timeoutMs });
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
   * RETRY-SPECIFIC: Fetch with more aggressive limits (1-day min, 25s max timeout)
   * Used by background retry - gives up faster to avoid long waits
   * @private
   */
  async _fetchChunkAdaptiveRetry(startDay, endDay, chunkSizeIndex, workflowId, orgIds, allResults = []) {
    const CHUNK_SIZES = RewstApp.RETRY_CHUNK_SIZES;  // [6, 3, 2, 1] - stops at 1 day
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
        const chunkExecutions = await this._fetchExecutionsChunk(currentStart, currentEnd, workflowId, orgIds, { timeout: timeoutMs });
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
          // At 3-day minimum - give up on this range (don't go smaller)
          this._log(`   [RETRY] ❌ Failed at 3-day minimum - giving up on days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)}`);
          throw new Error(`RETRY_ABANDONED: Could not fetch days ${currentStart.toFixed(1)}-${currentEnd.toFixed(1)} even at 3-day chunks`);
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

    try {
      let allExecutions = [];

      if (daysBack && daysBack > 0) {
        this._log(`Using adaptive chunking (6→3→2→1→0.5→0.25→0.1 days) with progressive timeouts`);

        // Start with largest chunk size (index 0 = 6 days)
        allExecutions = await this._fetchChunkAdaptive(0, daysBack, 0, workflowId, orgIds);

        this._log(`Retrieved ${allExecutions.length} total execution(s) from adaptive chunks`);
      } else {
        this._log('Fetching all executions (no date filter - may be slow for large datasets)');
        allExecutions = await this._fetchExecutionsChunk(null, null, workflowId, orgIds, { timeout: timeoutMs });
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
      this._error('Failed to get recent executions', error);
      throw new Error(`Failed to get recent executions: ${error.message}`);
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
  const earlyReturnThreshold = Math.ceil(totalBatches * 0.8); // Return when 80% done (only if we have data)
  const maxWaitMs = 30000; // Max 30s before returning with what we have

  // Use standard timeout for initial parallel batches - faster initial render
  // Failed orgs will be retried in background with longer timeouts
  const batchOptions = { ...options, timeout: options.timeout || 10000 };

  this._log(`Fetching ${orgIds.length} orgs in ${totalBatches} batches (return early at ${earlyReturnThreshold}/${totalBatches} with data, or ${maxWaitMs/1000}s max, ${batchOptions.timeout/1000}s per-batch timeout)`);

  const batchStartTime = Date.now();
  const completedResults = [];
  const pendingBatches = new Map(); // Track which batches are still running
  let resolveEarly = null;

  // Promise that resolves when we can return early
  const earlyReturnPromise = new Promise(resolve => { resolveEarly = resolve; });

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

            // Check if we can return early - but ONLY if we have some executions
            // This prevents returning early with 0 results while the batch with all data is still loading
            const totalExecsSoFar = completedResults.reduce((sum, b) => sum + b.results.length, 0);
            if (completedResults.length >= earlyReturnThreshold && totalExecsSoFar > 0 && resolveEarly) {
              resolveEarly();
              resolveEarly = null;
            }
            return { results, batchIndex: batchNum, success: true };
          })
          .catch(error => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            pendingBatches.delete(batchNum);
            completedResults.push({ results: [], batchIndex: batchNum, elapsed: parseFloat(elapsed), success: false, failedOrgIds: batchOrgIds });
            this._error(`❌ Batch ${batchNum} FAILED after ${elapsed}s (${batchOrgIds.length} orgs)`, error);

            // Don't trigger early return on failures - wait for batches that might have data
            return { results: [], batchIndex: batchNum, success: false, failedOrgIds: batchOrgIds };
          });
      });
  });

  // Wait for either: early return threshold OR timeout OR all complete
  const timeoutPromise = new Promise(resolve => setTimeout(() => {
    if (resolveEarly) {
      this._log(`⏱️ Max wait ${maxWaitMs/1000}s reached, returning with ${completedResults.length}/${totalBatches} batches`);
      resolveEarly = null;
      resolve();
    }
  }, maxWaitMs));

  const allDonePromise = Promise.all(batchPromises).then(() => {
    if (resolveEarly) {
      resolveEarly();
      resolveEarly = null;
    }
  });

  // Wait for first of: early threshold, timeout, or all done
  await Promise.race([earlyReturnPromise, timeoutPromise, allDonePromise]);

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

      // Add failed orgs with their time chunk info (dedupe by orgId)
      failedOrgIds.forEach(orgId => {
        // Add chunk info for this org
        const chunkInfo = { orgId, daysAgoStart, daysAgoEnd };
        this._failedOrgBatchRetry.chunks.push(chunkInfo);

        // Add to orgIds if not already there
        if (!this._failedOrgBatchRetry.orgIds.includes(orgId)) {
          this._failedOrgBatchRetry.orgIds.push(orgId);
        }
      });

      this._log(`📋 Accumulated ${this._failedOrgBatchRetry.orgIds.length} unique failed org(s) for background retry`);
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
 * Retry failed org batches in the background
 * Call this after dashboard renders to recover data from orgs that timed out
 * Now handles ACCUMULATED failures from multiple time chunks
 * @param {number} timeoutMs - Timeout per org/chunk (default 30s)
 * @param {object} retryOptions - Additional options
 * @param {function} retryOptions.onProgress - Callback for progress updates: ({ completed, total, enrichedCount }) => void
 * @param {boolean} retryOptions.enrichAsYouGo - Enrich each org's results immediately (default: true)
 * @returns {Promise<Array|null>} Recovered AND enriched executions or null if none
 */
async retryFailedOrgBatches(timeoutMs = 30000, retryOptions = {}) {
  const { onProgress, enrichAsYouGo = true } = retryOptions;

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
  this._log(`🔄 BACKGROUND RETRY STARTING: ${orgIds.length} org(s) with SLIDING WINDOW (${PARALLEL_LIMIT} concurrent) + RETRY-SPECIFIC chunking (3-day min, 25s max)...`);

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
      this._log(`   🔄 Retrying org ${orgShort}... ${rangeDesc}`);

      // Use _fetchChunkAdaptiveRetry - more aggressive limits (3-day min, 25s max)
      const orgResults = await this._fetchChunkAdaptiveRetry(
        range.start, range.end, 0, workflowId, [orgId], []
      );

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
  // If too many orgs, batch into parallel queries
  if (orgIds && orgIds.length > RewstApp.ORG_BATCH_SIZE) {
    return await this._fetchExecutionsMultiOrg(daysAgoStart, daysAgoEnd, workflowId, orgIds, options);
  }

  // Otherwise, run single query
  return await this._fetchExecutionsChunkSingle(daysAgoStart, daysAgoEnd, workflowId, orgIds, options);
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
  const variables = {
    where: {},
    order: [["createdAt", "desc"]],
    search: {
      originatingExecutionId: { _eq: null }
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

  const result = await this._graphql('getWorkflowExecutions', query, variables, options);
  return result.workflowExecutions || [];
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

      // Build trigger lookup map: triggerId -> { trigger data + workflowId + workflowName }
      this._triggerCache = new Map();
      workflows.forEach(workflow => {
        if (workflow.triggers) {
          workflow.triggers.forEach(trigger => {
            this._triggerCache.set(trigger.id, {
              ...trigger,
              workflowId: workflow.id,
              workflowName: workflow.name,
              workflowType: workflow.type
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
    this._log('Reference cache cleared');
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
   * Returns configured/discovered URL, falls back to default
   */
 _getBaseUrl() {
  return this._baseUrl || REWST_DEFAULTS.BASE_URL;
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
          // Add form information if trigger has a formId
          if (cachedTrigger.formId && this._formCache) {
            const form = this._formCache.get(cachedTrigger.formId);
            if (form) {
              triggerInfo.formId = cachedTrigger.formId;
              triggerInfo.formName = form.name;
              triggerInfo.formLink = this._buildFormLink(cachedTrigger.formId);
            }
          }

          // Add workflow link
          if (cachedTrigger.workflowId) {
            triggerInfo.workflowLink = this._buildWorkflowLink(cachedTrigger.workflowId);
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

      this._log(`Retrieved ${result.workflows?.length || 0} workflow(s)`);
      return result.workflows || [];

    } catch (error) {
      this._error('Failed to get workflows', error);
      throw new Error(`Failed to get workflows: ${error.message}`);
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

      // Sort fields by index for each form
      forms.forEach(form => {
        if (form.fields && form.fields.length > 0) {
          form.fields.sort((a, b) => (a.index || 0) - (b.index || 0));
        }
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
    
    // Build links
    const workflowLink = this._buildWorkflowLink(execution.workflow?.id);
    const executionLink = this._buildExecutionLink(execution.id);
    
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
        throw new Error(`Request failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(result.errors)}`);
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