#!/usr/bin/env node

/**
 * Quick Start Script for UniProt & Proteins API MCP Server
 * 
 * This script demonstrates basic functionality and helps verify the server setup.
 * Run with: node quick-start.js
 */

const readline = require('readline');

class UniProtMCPQuickStart {
    constructor() {
        this.baseUrl = 'http://localhost:8787';
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async testConnection() {
        console.log('🔗 Testing MCP Server Connection...');
        
        try {
            const response = await fetch(`${this.baseUrl}/`);
            if (response.ok) {
                const text = await response.text();
                console.log('✅ Server is running:', text);
                return true;
            } else {
                console.log('❌ Server returned error:', response.status);
                return false;
            }
        } catch (error) {
            console.log('❌ Connection failed:', error.message);
            console.log('💡 Make sure to run "npm run dev" first');
            return false;
        }
    }

    async testUniProtSearch() {
        console.log('\n🔍 Testing UniProt Search...');
        
        const payload = {
            method: 'tools/call',
            params: {
                name: 'uniprot_query',
                arguments: {
                    operation: 'search',
                    query: 'organism_id:9606 AND reviewed:true',
                    fields: 'accession,protein_name,gene_names',
                    limit: 5
                }
            }
        };

        try {
            const response = await this.makeSSERequest(payload);
            console.log('✅ UniProt Search Results:');
            console.log(JSON.stringify(response, null, 2));
            return response;
        } catch (error) {
            console.log('❌ UniProt Search failed:', error.message);
            return null;
        }
    }

    async testProteinDetails() {
        console.log('\n🧬 Testing Protein Details (P04637 - TP53)...');
        
        const payload = {
            method: 'tools/call',
            params: {
                name: 'uniprot_query',
                arguments: {
                    operation: 'protein_details',
                    accession: 'P04637'
                }
            }
        };

        try {
            const response = await this.makeSSERequest(payload);
            console.log('✅ Protein Details Retrieved:');
            console.log(JSON.stringify(response, null, 2));
            return response;
        } catch (error) {
            console.log('❌ Protein Details failed:', error.message);
            return null;
        }
    }

    async testDataStaging() {
        console.log('\n📊 Testing Data Staging (Multiple Proteins)...');
        
        const payload = {
            method: 'tools/call',
            params: {
                name: 'data_manager',
                arguments: {
                    operation: 'fetch_and_stage',
                    accessions: 'P04637,P53_HUMAN,Q92793',
                    fields: 'accession,protein_name,gene_names,organism_name'
                }
            }
        };

        try {
            const response = await this.makeSSERequest(payload);
            console.log('✅ Data Staging Results:');
            console.log(JSON.stringify(response, null, 2));
            
            // Extract data_access_id if available
            const dataAccessId = this.extractDataAccessId(response);
            if (dataAccessId) {
                console.log(`\n📋 Data Access ID: ${dataAccessId}`);
                return dataAccessId;
            }
            return response;
        } catch (error) {
            console.log('❌ Data Staging failed:', error.message);
            return null;
        }
    }

    async testSQLQuery(dataAccessId) {
        if (!dataAccessId) {
            console.log('\n⚠️  Skipping SQL Query test (no data_access_id)');
            return;
        }

        console.log('\n💾 Testing SQL Query on Staged Data...');
        
        const payload = {
            method: 'tools/call',
            params: {
                name: 'data_manager',
                arguments: {
                    operation: 'query',
                    data_access_id: dataAccessId,
                    sql: 'SELECT accession, protein_name, organism_name FROM proteins LIMIT 10'
                }
            }
        };

        try {
            const response = await this.makeSSERequest(payload);
            console.log('✅ SQL Query Results:');
            console.log(JSON.stringify(response, null, 2));
            return response;
        } catch (error) {
            console.log('❌ SQL Query failed:', error.message);
            return null;
        }
    }

    async makeSSERequest(payload) {
        const response = await fetch(`${this.baseUrl}/sse/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
    }

    extractDataAccessId(response) {
        // Try to extract data_access_id from various response formats
        if (response.content && Array.isArray(response.content)) {
            for (const item of response.content) {
                if (item.text) {
                    const match = item.text.match(/data_access_id['":\s]*([a-zA-Z0-9-]+)/);
                    if (match) return match[1];
                }
            }
        }
        
        if (typeof response === 'object') {
            const str = JSON.stringify(response);
            const match = str.match(/data_access_id['":\s]*([a-zA-Z0-9-]+)/);
            if (match) return match[1];
        }
        
        return null;
    }

    async runInteractiveMode() {
        console.log('\n🎮 Interactive Mode');
        console.log('Enter your own UniProt queries or type "exit" to quit\n');
        
        while (true) {
            const operation = await this.question('Operation (search/protein_details/protein_features): ');
            if (operation.toLowerCase() === 'exit') break;
            
            let payload;
            if (operation === 'search') {
                const query = await this.question('Search Query: ');
                const limit = await this.question('Limit (default 10): ') || '10';
                
                payload = {
                    method: 'tools/call',
                    params: {
                        name: 'uniprot_query',
                        arguments: {
                            operation: 'search',
                            query: query,
                            limit: parseInt(limit)
                        }
                    }
                };
            } else if (operation === 'protein_details') {
                const accession = await this.question('Protein Accession: ');
                
                payload = {
                    method: 'tools/call',
                    params: {
                        name: 'uniprot_query',
                        arguments: {
                            operation: 'protein_details',
                            accession: accession
                        }
                    }
                };
            } else {
                console.log('Invalid operation. Try: search, protein_details, or exit');
                continue;
            }
            
            try {
                console.log('\n⏳ Making request...');
                const response = await this.makeSSERequest(payload);
                console.log('📋 Response:');
                console.log(JSON.stringify(response, null, 2));
            } catch (error) {
                console.log('❌ Request failed:', error.message);
            }
            
            console.log('\n' + '─'.repeat(50) + '\n');
        }
    }

    question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    async run() {
        console.log('🧬 UniProt & Proteins API MCP Server - Quick Start\n');
        
        // Test connection
        const connected = await this.testConnection();
        if (!connected) {
            process.exit(1);
        }
        
        // Run basic tests
        console.log('\n🧪 Running Basic Tests...');
        await this.testUniProtSearch();
        await this.testProteinDetails();
        
        const dataAccessId = await this.testDataStaging();
        await this.testSQLQuery(dataAccessId);
        
        console.log('\n✨ All tests completed!');
        
        // Ask if user wants interactive mode
        const interactive = await this.question('\nWould you like to try interactive mode? (y/n): ');
        if (interactive.toLowerCase() === 'y' || interactive.toLowerCase() === 'yes') {
            await this.runInteractiveMode();
        }
        
        console.log('\n👋 Thanks for using UniProt MCP Server!');
        this.rl.close();
    }
}

// Run the quick start if this file is executed directly
if (require.main === module) {
    const quickStart = new UniProtMCPQuickStart();
    quickStart.run().catch(error => {
        console.error('💥 Quick start failed:', error);
        process.exit(1);
    });
}

module.exports = UniProtMCPQuickStart;