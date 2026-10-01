const{PrismaClient}=require('@prisma/client');
const crypto=require('crypto');
const{randomBytes,scrypt:scryptCb}=crypto;
const{promisify}=require('util');
const scrypt=promisify(scryptCb);
const SCRYPT_N=16384,SCRYPT_R=8,SCRYPT_P=1,SCRYPT_KEYLEN=64,SCRYPT_MAXMEM=64*1024*1024,SALT_BYTES=16;

async function hacher(mp){
  const salt=randomBytes(SALT_BYTES);
  const cle=await scrypt(mp.normalize('NFKC'),salt,SCRYPT_KEYLEN,{N:SCRYPT_N,r:SCRYPT_R,p:SCRYPT_P,maxmem:SCRYPT_MAXMEM});
  return ['scrypt',SCRYPT_N,SCRYPT_R,SCRYPT_P,salt.toString('base64'),cle.toString('base64')].join('$');
}

const p=new PrismaClient();
(async()=>{
  const password='Operateur2026!';
  const pwdHash=await hacher(password);

  const emp1=await p.employee.upsert({where:{matricule:'ADM-0010'},update:{},create:{matricule:'ADM-0010',firstName:'Karim',lastName:'Benzema',factory:'ADMEDCO',jobTitle:'Operateur polyvalent',isActive:true,hireDate:new Date('2024-01-15')}});
  const emp2=await p.employee.upsert({where:{matricule:'MBX-0010'},update:{},create:{matricule:'MBX-0010',firstName:'Sofiane',lastName:'Mahiou',factory:'MOBILIX',jobTitle:'Operateur polyvalent',isActive:true,hireDate:new Date('2024-03-01')}});
  console.log('Employees: ADM-0010, MBX-0010');

  const user1=await p.user.upsert({where:{email:'karim.admedco@admedco.dz'},update:{},create:{email:'karim.admedco@admedco.dz',passwordHash:pwdHash,isActive:true}});
  const user2=await p.user.upsert({where:{email:'sofiane.mobilix@admedco.dz'},update:{},create:{email:'sofiane.mobilix@admedco.dz',passwordHash:pwdHash,isActive:true}});
  console.log('Users: karim.admedco@admedco.dz, sofiane.mobilix@admedco.dz');

  await p.employee.update({where:{id:emp1.id},data:{userId:user1.id}});
  await p.employee.update({where:{id:emp2.id},data:{userId:user2.id}});

  const roleAdm=await p.role.findUnique({where:{code:'OPERATEUR_ADMEDCO'}});
  const roleMbx=await p.role.findUnique({where:{code:'OPERATEUR_MOBILIX'}});
  await p.userRole.upsert({where:{userId_roleId:{userId:user1.id,roleId:roleAdm.id}},update:{},create:{userId:user1.id,roleId:roleAdm.id}});
  await p.userRole.upsert({where:{userId_roleId:{userId:user2.id,roleId:roleMbx.id}},update:{},create:{userId:user2.id,roleId:roleMbx.id}});
  console.log('Roles: OPERATEUR_ADMEDCO, OPERATEUR_MOBILIX');

  const adm=await p.user.findFirst({where:{email:'admin@admedco.dz'}});
  const depotAdm=await p.warehouse.findUnique({where:{id:1}});
  const depotMbx=await p.warehouse.findUnique({where:{id:2}});

  let of1=await p.workOrder.findFirst({where:{number:'OF-2026-001'}});
  if(!of1){
    const opCoupe=await p.operation.findUnique({where:{id:1}});
    const wcCoupe=await p.workCenter.findUnique({where:{id:1}});
    const opPoudrage=await p.operation.findUnique({where:{id:6}});
    const wcPoudrage=await p.workCenter.findUnique({where:{id:6}});
    of1=await p.workOrder.create({data:{number:'OF-2026-001',itemId:1,factory:'ADMEDCO',status:'LANCE',quantityPlanned:50,quantityLaunched:50}});
    const woo1=await p.workOrderOperation.create({data:{workOrderId:of1.id,stepNo:1,operationId:opCoupe.id,workCenterId:wcCoupe.id,quantityPlanned:50,status:'EN_COURS'}});
    await p.workOrderOperation.create({data:{workOrderId:of1.id,stepNo:6,operationId:opPoudrage.id,workCenterId:wcPoudrage.id,quantityPlanned:50,status:'NON_DEMARREE'}});
    const jour=new Date();const j=new Date(Date.UTC(jour.getFullYear(),jour.getMonth(),jour.getDate()));
    await p.assignment.create({data:{employeeId:emp1.id,date:j,factory:'ADMEDCO',operationId:opCoupe.id,workCenterId:wcCoupe.id,workOrderId:of1.id,workOrderOperationId:woo1.id,warehouseId:depotAdm.id,status:'PLANIFIEE',priority:'NORMALE',sequenceOrder:1,plannedQuantity:50}});
    console.log('OF-2026-001 + assignment ADMEDCO');
  }else{console.log('OF-2026-001 exists');}

  let of2=await p.workOrder.findFirst({where:{number:'OF-2026-002'}});
  if(!of2){
    const opCouture=await p.operation.findUnique({where:{id:9}});
    const wcCouture=await p.workCenter.findUnique({where:{id:9}});
    of2=await p.workOrder.create({data:{number:'OF-2026-002',itemId:1,factory:'MOBILIX',status:'LANCE',quantityPlanned:30,quantityLaunched:30}});
    const woo2=await p.workOrderOperation.create({data:{workOrderId:of2.id,stepNo:1,operationId:opCouture.id,workCenterId:wcCouture.id,quantityPlanned:30,status:'EN_COURS'}});
    const jour=new Date();const j=new Date(Date.UTC(jour.getFullYear(),jour.getMonth(),jour.getDate()));
    await p.assignment.create({data:{employeeId:emp2.id,date:j,factory:'MOBILIX',operationId:opCouture.id,workCenterId:wcCouture.id,workOrderId:of2.id,workOrderOperationId:woo2.id,warehouseId:depotMbx.id,status:'PLANIFIEE',priority:'NORMALE',sequenceOrder:1,plannedQuantity:30}});
    console.log('OF-2026-002 + assignment MOBILIX');
  }else{console.log('OF-2026-002 exists');}

  // QR tokens on WorkCenters
  const wc1=await p.workCenter.findUnique({where:{id:1}});
  const wc9=await p.workCenter.findUnique({where:{id:9}});
  if(!wc1.qrToken){
    const t1=crypto.randomBytes(16).toString('hex');
    await p.workCenter.update({where:{id:wc1.id},data:{qrToken:t1,qrGeneratedAt:new Date()}});
    console.log('QR PT-COUPE:',t1);
  }else{console.log('QR PT-COUPE:',wc1.qrToken);}
  if(!wc9.qrToken){
    const t9=crypto.randomBytes(16).toString('hex');
    await p.workCenter.update({where:{id:wc9.id},data:{qrToken:t9,qrGeneratedAt:new Date()}});
    console.log('QR PT-COUTURE:',t9);
  }else{console.log('QR PT-COUTURE:',wc9.qrToken);}

  console.log('\n=== COMPTES DEMO ===');
  console.log('ADMEDCO: karim.admedco@admedco.dz / '+password);
  console.log('MOBILIX: sofiane.mobilix@admedco.dz / '+password);

  await p.$disconnect();
})().catch(e=>{console.error('ERROR:',e.message);process.exit(1)});
