const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

canvas.width = 720;
canvas.height = 540;


const pose = new Pose({

    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
    }

});


pose.setOptions({

    modelComplexity: 1,

    smoothLandmarks: true,

    enableSegmentation: false,

    minDetectionConfidence: 0.5,

    minTrackingConfidence: 0.5

});



pose.onResults((results)=>{


    ctx.save();

    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    if(results.poseLandmarks){


        // DIBUJAR CONEXIONES DEL CUERPO
        drawConnectors(
            ctx,
            results.poseLandmarks,
            POSE_CONNECTIONS,
            {
                color:"#00FF00",
                lineWidth:5
            }
        );


        // DIBUJAR PUNTOS
        drawLandmarks(
            ctx,
            results.poseLandmarks,
            {
                color:"#FF0000",
                fillColor:"#FF0000",
                radius:6
            }
        );


        console.log(
            "Puntos detectados:",
            results.poseLandmarks.length
        );


    }


    ctx.restore();


});
