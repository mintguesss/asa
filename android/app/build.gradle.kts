plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "tw.asa.alarm"
    compileSdk = 35

    defaultConfig {
        applicationId = "tw.asa.alarm"
        minSdk = 26
        targetSdk = 35
        versionCode = 14
        versionName = "2.3"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false; checkReleaseBuilds = false }
}
