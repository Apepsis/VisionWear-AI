const video = document.getElementById("camera");


const camera = new Camera(video,{

onFrame: async ()=>{

await pose.send({
image:video
});

},

width:720,
height:540

});


camera.start();
