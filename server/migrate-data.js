// migrate-data.js - One-time script to migrate data.json to MongoDB
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Trip = require('./models/Trip');

// MongoDB connection string - you'll need to set this
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/trip-budget-manager';

async function migrateData() {
    try {
        console.log('🔄 Starting data migration...');

        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected to MongoDB');

        // Read old data.json file
        const dataFilePath = path.join(__dirname, 'data.json');

        if (!fs.existsSync(dataFilePath)) {
            console.log('❌ No data.json file found. Nothing to migrate.');
            process.exit(0);
        }

        const rawData = fs.readFileSync(dataFilePath, 'utf8');
        const oldData = JSON.parse(rawData);

        console.log('📖 Read data from data.json');
        console.log(`   - Trip: ${oldData.tripName || 'Unnamed'}`);
        console.log(`   - Members: ${oldData.members?.length || 0}`);
        console.log(`   - Expenses: ${oldData.expenses?.length || 0}`);

        // Check if trip already exists in MongoDB
        const existingTrip = await Trip.findOne({ tripCode: oldData.tripCode });

        if (existingTrip) {
            console.log('⚠️  Trip already exists in MongoDB!');
            console.log('   Do you want to overwrite? (This will delete existing MongoDB data)');
            console.log('   To overwrite, run: node server/migrate-data.js --force');

            if (!process.argv.includes('--force')) {
                console.log('❌ Migration cancelled. Use --force to overwrite.');
                process.exit(0);
            }

            console.log('🗑️  Deleting existing trip...');
            await Trip.deleteOne({ tripCode: oldData.tripCode });
        }

        // Ensure all required fields exist with defaults
        const tripData = {
            tripCode: oldData.tripCode || generateTripCode(),
            tripName: oldData.tripName || '',
            budget: oldData.budget || 0,
            memberCount: oldData.memberCount || 0,
            tripDate: oldData.tripDate || '',
            adminPin: oldData.adminPin || '',
            members: oldData.members || [],
            expenses: oldData.expenses || [],
            pendingExpenses: oldData.pendingExpenses || [],
            pendingMembers: oldData.pendingMembers || [],
            pendingContributions: oldData.pendingContributions || [],
            pendingBudgetRequests: oldData.pendingBudgetRequests || [],
            pendingDeletions: oldData.pendingDeletions || []
        };

        // Create new trip in MongoDB
        const newTrip = new Trip(tripData);
        await newTrip.save();

        console.log('✅ Migration successful!');
        console.log(`   - Trip Code: ${newTrip.tripCode}`);
        console.log(`   - Trip Name: ${newTrip.tripName}`);
        console.log(`   - Members migrated: ${newTrip.members.length}`);
        console.log(`   - Expenses migrated: ${newTrip.expenses.length}`);

        // Create backup of old data.json
        const backupPath = path.join(__dirname, `data.json.backup.${Date.now()}`);
        fs.copyFileSync(dataFilePath, backupPath);
        console.log(`📦 Backup created: ${backupPath}`);

        console.log('\n🎉 All done! Your data is now in MongoDB.');
        console.log('   You can safely delete data.json or keep it as backup.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

function generateTripCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Run migration
migrateData();
