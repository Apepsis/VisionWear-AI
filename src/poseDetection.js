const canvas = document.getElementById("canvas");

const ctx = canvas.getContext("2d");


canvas.width = 720;
canvas.height = 540;



const pose = new Pose({

locateFile:(file)=>{

return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;

}

});



pose.setOptions({

modelComplexity:1,

smoothLandmarks:true,

enableSegmentation:false,

minDetectionConfidence:0.5,

minTrackingConfidence:0.5

});





pose.onResults(results=>{


ctx.clearRect(
0,
0,
canvas.width,
canvas.height
);



if(results.poseLandmarks){


drawConnectors(

ctx,

results.poseLandmarks,

POSE_CONNECTIONS,

{
color:"#00ff00",
lineWidth:3
}

);



drawLandmarks(

ctx,

results.poseLandmarks,

{
color:"#ff0000",
radius:4
}

);



}



});
