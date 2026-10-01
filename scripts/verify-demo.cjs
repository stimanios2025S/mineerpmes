const{PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
  const emp=await p.employee.findUnique({where:{matricule:'ADM-0010'},include:{user:{select:{id:true,email:true,roles:{select:{role:{select:{code:true}}}}}}}});
  console.log('Employee ADM-0010:',JSON.stringify(emp,null,2));
  const ass=await p.assignment.findMany({include:{operation:{select:{code:true,label:true}},workOrder:{select:{number:true}},employee:{select:{matricule:true,firstName:true}}}});
  console.log('Assignments:',JSON.stringify(ass,null,2));
  const wcs=await p.workCenter.findMany({where:{qrToken:{not:null}},select:{code:true,qrToken:true}});
  console.log('QR tokens:',JSON.stringify(wcs));
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});
