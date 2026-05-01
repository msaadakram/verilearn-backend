const mongoose = require('mongoose');
const User = require('./src/models/User');

(async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/verilearn');
    
    // Find ALL users
    const allUsers = await User.find({}).select('name email profession createdAt');
    
    console.log('\n📋 ALL USERS IN DATABASE:\n');
    console.log(`Total Users: ${allUsers.length}\n`);
    
    for (const user of allUsers) {
      console.log(`Name: ${user.name}`);
      console.log(`Email: ${user.email}`);
      console.log(`Profession: ${user.profession}`);
      console.log(`Created: ${user.createdAt.toISOString()}`);
      console.log('---');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
