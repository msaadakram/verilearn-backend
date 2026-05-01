const mongoose = require('mongoose');
const User = require('./src/models/User');
const CnicVerification = require('./src/models/CnicVerification');

(async () => {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/verilearn');
    
    // Find all teachers
    const teachers = await User.find({ profession: 'teacher' }).select('name email teacherProfile');
    
    console.log('\n📋 ALL TEACHERS STATUS:\n');
    
    for (const teacher of teachers) {
      const cnicVerif = await CnicVerification.findOne({ userId: teacher._id }).sort({ createdAt: -1 }).select('status');
      const cnicStatus = cnicVerif?.status || 'Not Submitted';
      const assessmentPassed = teacher.teacherProfile?.assessment?.passed === true;
      const profileCompleted = teacher.teacherProfile?.profileCompleted === true;
      const isQualified = cnicStatus === 'Verified' && assessmentPassed && profileCompleted;
      
      console.log(`Name: ${teacher.name}`);
      console.log(`Email: ${teacher.email}`);
      console.log(`  CNIC Status: ${cnicStatus} ${cnicStatus === 'Verified' ? '✓' : '✗'}`);
      console.log(`  Assessment Passed: ${assessmentPassed ? '✓' : '✗'}`);
      console.log(`  Profile Complete: ${profileCompleted ? '✓' : '✗'}`);
      console.log(`  → Qualified for Student View: ${isQualified ? '✅ YES' : '❌ NO'}`);
      console.log('');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
