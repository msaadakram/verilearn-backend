const mongoose = require('mongoose');
const User = require('./src/models/User');

(async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/verilearn');
    
    // Update saad arham to teacher
    const result = await User.updateOne(
      { email: 'arhamsaadm453@gmail.com' },
      { profession: 'teacher' }
    );
    
    if (result.modifiedCount > 0) {
      console.log('✅ Successfully switched saad arham to teacher mode!');
    } else {
      console.log('❌ User not found or already teacher');
    }
    
    // Show updated status
    const updatedUser = await User.findOne({ email: 'arhamsaadm453@gmail.com' }).select('name email profession');
    console.log('\nUpdated user:');
    console.log(`Name: ${updatedUser.name}`);
    console.log(`Email: ${updatedUser.email}`);
    console.log(`Profession: ${updatedUser.profession}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
